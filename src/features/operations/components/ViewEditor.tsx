import { stateLabel } from '../state-label';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  OperationViewConfig,
  OperationQueue,
  SavedOperationView,
  StateFilterDto,
} from '@/generated/RuntaraRuntimeApi';
import { useToken } from '@/shared/hooks';
import { useCustomQuery } from '@/shared/hooks/api';
import { useAuthStore } from '@/shared/stores/authStore';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  currentRevision,
  isRevisionConflict,
  operationsRequest,
  message,
  queryRequests,
} from '../queries';
import { type StateField } from './StateValue';
import { RUN_STATUS_OPTIONS } from '@/features/invocation-history/status-options';

export function ViewEditor({
  initial,
  saved,
  schema,
  onSaved,
  onCancel,
  requestSources,
}: {
  requestSources?: OperationQueue[];
  initial: OperationViewConfig;
  saved?: SavedOperationView;
  schema: Record<string, StateField>;
  onSaved: (view: SavedOperationView) => void;
  onCancel: () => void;
}) {
  const [view, setView] = useState(initial);
  // Save against the revision this form was opened with, even if discovery
  // refreshes; only a conflict the user has seen moves it on (OP-12).
  const [revision, setRevision] = useState(saved?.revision);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const statuses = (view.where?.status ?? '')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);
  const token = useToken();
  const client = useQueryClient();
  const fields = [
    ...new Set([...Object.keys(schema), ...(view.columns ?? [])]),
  ];
  const tenant = useAuthStore((s) => s.orgId);
  // The answer fields a request offers are only known from a request, so one
  // open request of the step, when there is one, supplies the choices.
  const step = view.where?.openRequest;
  const sample = useCustomQuery({
    queryKey: ['operations', tenant, 'answer-fields', view.workflow, step],
    queryFn: async (token: string) =>
      (
        await queryRequests(
          token,
          {
            ...view,
            columns: [],
            roles: {},
            sort: null,
            where: { openRequest: step },
          },
          0,
          '',
          1
        )
      ).content[0]?.inputSchema ?? null,
    enabled: Boolean(step),
    placeholderData: undefined,
  });
  const answerFields = Object.entries(
    ((sample.data as { properties?: unknown } | null)?.properties ??
      sample.data ??
      {}) as Record<string, { enum?: unknown[]; title?: string }>
  ).filter(([, field]) => Array.isArray(field?.enum));
  const update = (change: Partial<OperationViewConfig>) =>
    setView((v) => ({ ...v, ...change }));
  async function save() {
    setSaving(true);
    setError('');
    try {
      const result = await operationsRequest<SavedOperationView>(
        token,
        `operations/views${saved ? `/${saved.id}` : ''}`,
        saved ? 'PUT' : 'POST',
        { configuration: view, revision }
      );
      await client.invalidateQueries({ queryKey: ['operations'] });
      onSaved(result);
    } catch (e) {
      if (saved && isRevisionConflict(e)) {
        const latest = await currentRevision(token, saved.id).catch(
          () => undefined
        );
        if (latest !== undefined) setRevision(latest);
        setError(
          `${message(e)}. Someone else changed this queue; saving again replaces their changes.`
        );
      } else setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      aria-label="Queue settings"
      className="m-6 space-y-5 rounded-lg border bg-muted/20 p-5"
    >
      <h2 className="text-lg font-semibold">Queue settings</h2>
      <label className="block max-w-lg text-sm">
        Name
        <Input
          value={view.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      {requestSources && (
        <label className="block max-w-lg text-sm">
          Shows
          <select
            aria-label="Shows"
            className="mt-1 block h-9 w-full rounded border bg-background px-3"
            value={view.where?.openRequest ?? ''}
            onChange={(event) =>
              update({
                where: {
                  ...view.where,
                  openRequest: event.target.value || null,
                  status: undefined,
                },
                answers: { ...view.answers, inline: null, bulk: false },
              })
            }
          >
            <option value="">Runs of this workflow (no requests)</option>
            {view.where?.openRequest &&
              !requestSources.some(
                (source) => source.actionKey === view.where?.openRequest
              ) && (
                <option value={view.where.openRequest}>
                  {view.where.openRequest} (older requests)
                </option>
              )}
            {requestSources.map((source) => (
              <option key={source.actionKey} value={source.actionKey}>
                Requests waiting at “{source.name}”
              </option>
            ))}
          </select>
        </label>
      )}
      {!view.where?.openRequest && (
        <fieldset className="max-w-2xl space-y-2 text-sm">
          <legend className="mb-2">Run status</legend>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              bordered
              className="rounded-full aria-pressed:border-primary aria-pressed:bg-primary/10"
              aria-pressed={statuses.length === 0}
              onClick={() => update({ where: { ...view.where, status: null } })}
            >
              {statuses.length === 0 && <Check aria-hidden="true" />}
              All statuses
            </Button>
            {RUN_STATUS_OPTIONS.map(({ value, label }) => {
              const selected = statuses.includes(value);
              return (
                <Button
                  key={value}
                  type="button"
                  variant="secondary"
                  bordered
                  className="rounded-full aria-pressed:border-primary aria-pressed:bg-primary/10"
                  aria-pressed={selected}
                  onClick={() => {
                    const next = selected
                      ? statuses.filter((status) => status !== value)
                      : [...statuses, value];
                    update({
                      where: { ...view.where, status: next.join(',') || null },
                    });
                  }}
                >
                  {selected && <Check aria-hidden="true" />}
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Select one or more statuses. No selection includes all statuses.
          </p>
        </fieldset>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Order by
          <select
            aria-label="Order by"
            className="mt-1 block h-9 rounded border bg-background px-3"
            value={view.sort?.field ?? ''}
            onChange={(event) =>
              update({
                sort: event.target.value
                  ? {
                      field: event.target.value,
                      descending: view.sort?.descending ?? false,
                    }
                  : null,
              })
            }
          >
            <option value="">
              {view.where?.openRequest
                ? 'Longest waiting first'
                : 'Newest first'}
            </option>
            {fields.map((field) => (
              <option key={field} value={field}>
                {stateLabel(field, schema[field])}
              </option>
            ))}
          </select>
        </label>
        {view.sort && (
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={view.sort.descending ?? false}
              onChange={(event) =>
                update({
                  sort: { ...view.sort!, descending: event.target.checked },
                })
              }
            />
            Descending
          </label>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            [
              'due',
              'Due time',
              'No due time',
              'A date field of the run. Requests past it count as overdue.',
            ],
            [
              'key',
              'Shown as',
              'Run label',
              'What each row is called, such as an order number.',
            ],
            [
              'stage',
              'Stage',
              'None',
              'A field with a fixed set of values, shown as progress on the run page.',
            ],
          ] as const
        ).map(([role, label, none, help]) => (
          <label key={role} className="text-sm">
            {label}
            <select
              aria-label={label}
              className="mt-1 block w-full rounded border bg-background p-2"
              value={view.roles?.[role] ?? ''}
              onChange={(e) =>
                update({
                  roles: { ...view.roles, [role]: e.target.value || null },
                })
              }
            >
              <option value="">{none}</option>
              {fields.map((field) => (
                <option key={field} value={field}>
                  {stateLabel(field, schema[field])}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {help}
            </span>
          </label>
        ))}
      </div>
      <details className="rounded-md border bg-background p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Columns and formats ({view.columns?.length ?? 0} shown)
        </summary>
        <div className="mt-3 space-y-2">
          {fields.map((field) => {
            const format = view.formats?.[field] ?? {};
            return (
              <div
                key={field}
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                <label className="min-w-40">
                  <input
                    type="checkbox"
                    checked={view.columns?.includes(field) ?? false}
                    onChange={(e) =>
                      update({
                        columns: e.target.checked
                          ? [...(view.columns ?? []), field]
                          : (view.columns ?? []).filter((f) => f !== field),
                      })
                    }
                  />{' '}
                  {stateLabel(field, schema[field])}
                </label>
                <Input
                  className="w-36"
                  aria-label={`${field} label`}
                  placeholder="Label"
                  value={view.labels?.[field] ?? ''}
                  onChange={(e) =>
                    update({
                      labels: { ...view.labels, [field]: e.target.value },
                    })
                  }
                />
                <select
                  aria-label={`${field} display`}
                  className="rounded border bg-background p-2"
                  value={format.kind ?? ''}
                  onChange={(e) =>
                    update({
                      formats: {
                        ...view.formats,
                        [field]: {
                          ...format,
                          kind: (e.target.value || null) as typeof format.kind,
                        },
                      },
                    })
                  }
                >
                  {['', 'text', 'number', 'date', 'datetime', 'relative'].map(
                    (kind) => (
                      <option key={kind} value={kind}>
                        {kind || 'Automatic'}
                      </option>
                    )
                  )}
                </select>
                {format.kind === 'number' ? (
                  <>
                    <Input
                      aria-label={`${field} decimals`}
                      className="w-24"
                      type="number"
                      min={0}
                      max={20}
                      placeholder="Decimals"
                      value={format.decimals ?? ''}
                      onChange={(e) =>
                        update({
                          formats: {
                            ...view.formats,
                            [field]: {
                              ...format,
                              decimals:
                                e.target.value === ''
                                  ? null
                                  : Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                    <Input
                      aria-label={`${field} prefix`}
                      className="w-24"
                      placeholder="Prefix"
                      value={format.prefix ?? ''}
                      onChange={(e) =>
                        update({
                          formats: {
                            ...view.formats,
                            [field]: { ...format, prefix: e.target.value },
                          },
                        })
                      }
                    />
                    <Input
                      aria-label={`${field} suffix`}
                      className="w-24"
                      placeholder="Suffix"
                      value={format.suffix ?? ''}
                      onChange={(e) =>
                        update({
                          formats: {
                            ...view.formats,
                            [field]: { ...format, suffix: e.target.value },
                          },
                        })
                      }
                    />
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </details>
      <StateFilters
        filters={view.where?.state ?? []}
        fields={fields}
        schema={schema}
        onChange={(state) => update({ where: { ...view.where, state } })}
      />
      {view.where?.openRequest ? (
        <div className="flex flex-wrap items-start gap-4">
          <label className="text-sm">
            Answer buttons
            {answerFields.length ? (
              <select
                aria-label="Answer buttons"
                className="mt-1 block h-9 rounded border bg-background px-3"
                value={view.answers?.inline ?? ''}
                onChange={(e) =>
                  update({
                    answers: {
                      bulk: e.target.value
                        ? (view.answers?.bulk ?? false)
                        : false,
                      inline: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">None, open each request</option>
                {view.answers?.inline &&
                  !answerFields.some(
                    ([name]) => name === view.answers?.inline
                  ) && (
                    <option value={view.answers.inline}>
                      {stateLabel(view.answers.inline)}
                    </option>
                  )}
                {answerFields.map(([name, field]) => (
                  <option key={name} value={name}>
                    {field.title ?? stateLabel(name)}:{' '}
                    {field.enum!.map((v) => stateLabel(String(v))).join(', ')}
                  </option>
                ))}
              </select>
            ) : (
              // With no open request to read the choices from, the field is named.
              <Input
                aria-label="Answer buttons"
                placeholder="Answer field name"
                value={view.answers?.inline ?? ''}
                onChange={(e) =>
                  update({
                    answers: {
                      bulk: e.target.value
                        ? (view.answers?.bulk ?? false)
                        : false,
                      inline: e.target.value || null,
                    },
                  })
                }
              />
            )}
            <span className="mt-1 block max-w-xs text-xs text-muted-foreground">
              {answerFields.length
                ? 'Each row gets one button per choice. A one-click answer can be undone for a few seconds.'
                : 'The name of the answer field whose choices become buttons in each row. Leave empty to open each request.'}
            </span>
          </label>
          <label className="mt-6 text-sm">
            <input
              type="checkbox"
              disabled={!view.answers?.inline}
              checked={Boolean(view.answers?.inline && view.answers?.bulk)}
              onChange={(e) =>
                update({ answers: { ...view.answers, bulk: e.target.checked } })
              }
            />{' '}
            Answer several at once
            <span className="mt-1 block max-w-xs text-xs text-muted-foreground">
              {view.answers?.inline
                ? 'Selected rows are answered together after one confirmation.'
                : 'Needs answer buttons.'}
            </span>
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          disabled={saving || !view.name.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : saved ? 'Save changes' : 'Create queue'}
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** The server's filter operators, as a sentence reads them. */
const OPERATORS: Record<string, string> = {
  eq: 'is',
  ne: 'is not',
  lt: 'is less than / before',
  lte: 'is at most / not after',
  gt: 'is greater than / after',
  gte: 'is at least / not before',
  exists: 'is set (true or false)',
};

export function StateFilters({
  filters,
  fields,
  schema,
  onChange,
}: {
  filters: StateFilterDto[];
  fields: string[];
  schema: Record<string, StateField>;
  onChange: (f: StateFilterDto[]) => void;
}) {
  const change = (index: number, patch: Partial<StateFilterDto>) =>
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Only show when</legend>
      {filters.map((filter, index) => {
        const relative = Boolean(
          filter.value &&
          typeof filter.value === 'object' &&
          'relative' in filter.value
        );
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Filter ${index + 1} field`}
              className="rounded border bg-background p-2"
              value={filter.field}
              onChange={(e) => change(index, { field: e.target.value })}
            >
              {fields.map((field) => (
                <option key={field} value={field}>
                  {stateLabel(field, schema[field])}
                </option>
              ))}
            </select>
            <select
              aria-label={`Filter ${index + 1} operator`}
              className="rounded border bg-background p-2"
              value={filter.op}
              onChange={(e) => change(index, { op: e.target.value })}
            >
              {Object.entries(OPERATORS).map(([op, label]) => (
                <option key={op} value={op}>
                  {label}
                </option>
              ))}
            </select>
            <Input
              className="w-52"
              aria-label={`Filter ${index + 1} value`}
              disabled={relative}
              value={
                relative
                  ? 'Now'
                  : typeof filter.value === 'object'
                    ? JSON.stringify(filter.value)
                    : String(filter.value ?? '')
              }
              onChange={(e) => {
                let value: unknown = e.target.value;
                if (
                  schema[filter.field]?.type === 'number' ||
                  schema[filter.field]?.type === 'integer'
                )
                  value = e.target.value === '' ? '' : Number(e.target.value);
                if (
                  schema[filter.field]?.type === 'boolean' ||
                  filter.op === 'exists'
                )
                  value = e.target.value === 'true';
                change(index, { value: value as StateFilterDto['value'] });
              }}
            />
            <label className="text-sm">
              <input
                type="checkbox"
                checked={relative}
                onChange={(e) =>
                  change(index, {
                    value: (e.target.checked
                      ? { relative: 'now', offsetSeconds: 0 }
                      : '') as StateFilterDto['value'],
                  })
                }
              />{' '}
              the current time
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange(filters.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <Button
        variant="secondary"
        size="sm"
        disabled={!fields.length || filters.length >= 16}
        onClick={() =>
          onChange([
            ...filters,
            {
              field: fields[0],
              op: 'eq',
              value: '' as unknown as StateFilterDto['value'],
            },
          ])
        }
      >
        Add condition
      </Button>
    </fieldset>
  );
}

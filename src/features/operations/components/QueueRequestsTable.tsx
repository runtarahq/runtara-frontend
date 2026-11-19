import { ArrowDown, ArrowUp } from 'lucide-react';
import { Link } from 'react-router';

import type {
  OperationRequest,
  OperationViewConfig,
} from '@/generated/RuntaraRuntimeApi';
import { cn } from '@/lib/utils';
import { Can } from '@/shared/components/Can';
import {
  DueValue,
  StateValue,
  type StateField,
} from '@/features/runs/components/StateValue';
import { stateLabel } from '@/features/runs/utils/state-label';
import { isNumeric, requestKey } from '@/features/operations/utils/queue-view';
import { QueueAnswer, type AnswerController } from './QueueAnswer';

/** The requests of a queue: one row each, with its state and its answer. */
export function QueueRequestsTable({
  rows,
  view,
  schema,
  bulk,
  inferAnswers,
  selection,
  onSelectionChange,
  onSort,
  onAnswerController,
}: {
  rows: OperationRequest[];
  view: OperationViewConfig;
  schema: Record<string, StateField>;
  /** Whether requests can be selected and answered together. */
  bulk: boolean;
  /** Whether a row may offer answers its queue has not configured. */
  inferAnswers: boolean;
  selection: Set<string>;
  onSelectionChange: (selection: Set<string>) => void;
  onSort: (field: string) => void;
  /** Each row's answer form, as it mounts and unmounts. */
  onAnswerController: (
    key: string,
    controller: AnswerController | null
  ) => void;
}) {
  const columns = view.columns?.filter((field) => field !== view.roles?.key);
  const due = view.roles?.due;
  // Every row of a queue asks the same question; name it once in the header.
  const question = rows[0]?.label;
  // Context values that a column already shows are noise in the row.
  const shown = new Set([...(view.columns ?? []), view.roles?.key]);

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead className="sticky top-0 bg-muted/90 text-[11px] uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="w-12 px-4 py-3">
            <Can permission="workflow:execute">
              {bulk ? (
                <input
                  aria-label="Select page"
                  type="checkbox"
                  checked={
                    rows.length > 0 &&
                    rows.every((row) => selection.has(requestKey(row)))
                  }
                  onChange={(e) =>
                    onSelectionChange(
                      e.target.checked
                        ? new Set(rows.map(requestKey))
                        : new Set()
                    )
                  }
                />
              ) : null}
            </Can>
          </th>
          {view.roles?.key ? (
            <SortHeader
              field={view.roles.key}
              label={stateLabel(view.roles.key, schema[view.roles.key])}
              sort={view.sort}
              onSort={onSort}
            />
          ) : (
            <th className="px-4 py-3">Run</th>
          )}
          {columns?.map((field) => (
            <SortHeader
              key={field}
              field={field}
              label={view.labels?.[field] || stateLabel(field, schema[field])}
              numeric={isNumeric(schema[field])}
              sort={view.sort}
              onSort={onSort}
            />
          ))}
          <th className="px-4 py-3">{question ?? 'Decision'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={requestKey(row)}
            className={`border-b last:border-0 ${selection.has(requestKey(row)) ? 'bg-primary/5' : 'hover:bg-muted/20'}`}
          >
            <td className="px-4 py-3">
              <Can permission="workflow:execute">
                {bulk ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.runLabel ?? row.label} ${row.requestId}`}
                    checked={selection.has(requestKey(row))}
                    onChange={(e) => {
                      const next = new Set(selection);
                      if (e.target.checked) next.add(requestKey(row));
                      else next.delete(requestKey(row));
                      onSelectionChange(next);
                    }}
                  />
                ) : null}
              </Can>
            </td>
            <td className="max-w-64 px-4 py-3">
              <Link
                className="whitespace-nowrap font-medium text-primary-text hover:underline"
                to={`/operations/runs/${row.workflowId}/${row.instanceId}`}
              >
                {String(
                  (view.roles?.key && row.state?.[view.roles.key]) ??
                    row.runLabel ??
                    row.instanceId.slice(0, 8)
                )}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Requested{' '}
                <StateValue
                  value={row.requestedAt}
                  display={{ kind: 'relative' }}
                />
                {row.deadline ? (
                  <>
                    {' · deadline '}
                    <StateValue
                      value={row.deadline}
                      display={{ kind: 'relative' }}
                    />
                  </>
                ) : null}
              </p>
              {row.message && row.message !== row.label ? (
                <p className="mt-1 text-xs">{row.message}</p>
              ) : null}
              <RequestContext
                context={row.context}
                hide={shown}
                schema={schema}
                formats={view.formats}
              />
            </td>
            {columns?.map((field) => (
              <td
                key={field}
                className={`max-w-xs px-4 py-3 ${isNumeric(schema[field]) ? 'text-right tabular-nums' : ''}`}
              >
                {field === due ? (
                  <DueValue value={row.state?.[field]} />
                ) : (
                  <StateValue
                    value={row.state?.[field]}
                    field={schema[field]}
                    display={view.formats?.[field]}
                  />
                )}
              </td>
            ))}
            <td className="px-4 py-3">
              <Can
                permission="workflow:execute"
                fallback={
                  <span className="text-muted-foreground">Read only</span>
                }
              >
                <QueueAnswer
                  row={row}
                  inline={view.answers?.inline}
                  infer={inferAnswers}
                  ref={(controller) =>
                    onAnswerController(requestKey(row), controller)
                  }
                />
              </Can>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Context the request carries, as label/value pairs, minus what columns show. */
function RequestContext({
  context,
  hide,
  schema,
  formats,
}: {
  context: unknown;
  hide: Set<string | null | undefined>;
  schema: Record<string, StateField>;
  formats?: OperationViewConfig['formats'];
}) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return null;
  const entries = Object.entries(context).filter(([key]) => !hide.has(key));
  if (!entries.length) return null;
  return (
    <dl className="mt-1 space-y-0.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-muted-foreground">
            {stateLabel(key, schema[key])}:
          </dt>
          <dd className="min-w-0 truncate">
            <StateValue
              value={value}
              field={schema[key]}
              display={formats?.[key] ?? undefined}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SortHeader({
  field,
  label,
  numeric,
  sort,
  onSort,
}: {
  field: string;
  label: string;
  numeric?: boolean;
  sort?: OperationViewConfig['sort'];
  onSort: (field: string) => void;
}) {
  const active = sort?.field === field;
  const Arrow = sort?.descending ? ArrowDown : ArrowUp;
  return (
    <th
      aria-sort={
        active ? (sort?.descending ? 'descending' : 'ascending') : undefined
      }
      className={cn('px-4 py-3', numeric && 'text-right')}
    >
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground',
          active && 'text-foreground'
        )}
        onClick={() => onSort(field)}
      >
        {label}
        {active ? <Arrow className="size-3" /> : null}
      </button>
    </th>
  );
}

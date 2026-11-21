import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import { useCustomQuery } from '@/shared/hooks/api';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useAuthStore } from '@/shared/stores/authStore';
import { Can } from '@/shared/components/Can';
import { Input } from '@/shared/components/ui/input';
import { TablePagination } from '@/shared/components/console';
import { InputRetryPanel } from '@/features/workflows/components/ManagedInputSubmissions';
import { useManagedInputSubmissions } from '@/features/workflows/hooks/useManagedInputSubmissions';
import {
  attentionQueues,
  byUrgency,
  queryInbox,
  requestTitle,
  type AttentionQueue,
  type AttentionRequest,
} from '../attention-requests';
import { useOperations } from '../queries';
import { contextSummary } from '../request-context';
import { QueueAnswer } from '../components/QueueAnswer';
import { RequestPanel, RequestTiming } from '../components/RequestPanel';
import { RequestTabs } from '../components/RequestTabs';
import { OperationHeader, RefreshControls } from './shared';
import { failedWithNothingToShow } from '../poll-errors';

const PAGE_SIZE = 25;
const queueKey = ({ queue }: AttentionQueue) =>
  `${queue.workflowId}/${queue.actionKey}`;
const requestKey = ({ row }: AttentionRequest) =>
  `${row.instanceId}/${row.requestId}`;

/**
 * The inbox: every open request across all queues, most urgent first, each
 * answered in its row or in the panel beside the list. What is shown (tab,
 * queue, search, order, page, open request) is in the URL, so a view can be
 * reloaded or sent to someone.
 */
export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const overdue = params.get('filter') === 'overdue';
  const queueParam = params.get('queue');
  const oldest = params.get('sort') === 'oldest';
  const openKey = params.get('request');
  const rawPage = Number(params.get('page') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage - 1 : 0;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const term = useDebounce(search.trim(), 300);

  const { queues, views } = useOperations({ includeProcesses: false });
  const tenant = useAuthStore((s) => s.orgId);
  const client = useQueryClient();
  const submissions = useManagedInputSubmissions();
  const scopes = attentionQueues(queues.data ?? [], views.data ?? []);
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;
  const query = useCustomQuery({
    queryKey: [
      'operations',
      tenant,
      'inbox',
      scopes.map((scope) => `${queueKey(scope)}/${scope.view.roles?.due}`),
      term,
    ],
    queryFn: (token: string) => queryInbox(token, scopesRef.current, term),
    enabled: Boolean(queues.data && views.data),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  // A changed count means the list changed: ask for it now, not at the next
  // poll. The rows on screen stay until the answer arrives (OP-13).
  const waiting = scopes.reduce((sum, { queue }) => sum + queue.count, 0);
  const refetch = query.refetch;
  const counted = useRef(waiting);
  useEffect(() => {
    if (counted.current === waiting) return;
    counted.current = waiting;
    void refetch();
  }, [waiting, refetch]);

  /** Change what the URL says is shown; anything but paging returns to page one. */
  function show(changes: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params);
    if (!('page' in changes) && !('request' in changes)) next.delete('page');
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    setParams(next, { replace });
  }
  // The search box is typed into faster than the URL should change.
  useEffect(() => {
    if ((params.get('q') ?? '') !== term) show({ q: term || null }, true);
    // Only a settled search term moves the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  // An answer that went through takes its request off the list at once.
  const answered = submissions.inputs.filter(
    (input) => input.state === 'accepted'
  ).length;
  useEffect(() => {
    if (answered)
      void client.invalidateQueries({ queryKey: ['operations', tenant] });
  }, [answered, client, tenant]);

  const scope = scopes.find((candidate) => queueKey(candidate) === queueParam);
  const inQueue = (query.data?.requests ?? []).filter(
    (request) =>
      !scope ||
      (request.row.workflowId === scope.queue.workflowId &&
        request.row.actionKey === scope.queue.actionKey)
  );
  const tracksDue = (scope ? [scope] : scopes).some(({ view }) =>
    Boolean(view.roles?.due)
  );
  const list = inQueue
    .filter((request) => !overdue || request.isOverdue)
    .sort(
      oldest
        ? (a, b) => a.row.requestedAt.localeCompare(b.row.requestedAt)
        : byUrgency
    );
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = list.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const truncated = (query.data?.truncated ?? []).filter(
    ({ queue }) =>
      !scope ||
      (queue.workflowId === scope.queue.workflowId &&
        queue.actionKey === scope.queue.actionKey)
  );

  // The open request, and where to go when it is answered and leaves the list.
  const openIndex = list.findIndex(
    (request) => requestKey(request) === openKey
  );
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (!openKey || !query.data || query.isPlaceholderData) return;
    if (openIndex >= 0) {
      lastIndex.current = openIndex;
      return;
    }
    const next =
      lastIndex.current >= 0
        ? list[Math.min(lastIndex.current, list.length - 1)]
        : undefined;
    lastIndex.current = -1;
    show({ request: next ? requestKey(next) : null }, true);
    // Runs when the open request leaves the list, not on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, openIndex, query.data]);

  const error = queues.error || views.error || query.error;
  const unavailable = failedWithNothingToShow(queues, views, query);
  return (
    <div className="mx-auto min-h-full w-full max-w-[1600px] bg-background p-5 lg:px-10 lg:py-7">
      <OperationHeader
        title="Requests"
        description={
          scope
            ? `${scope.queue.name} · ${scope.queue.workflowName}`
            : 'Everything waiting on a person, across all workflows.'
        }
        actions={
          <RefreshControls
            busy={query.isFetching || queues.isFetching || views.isFetching}
            updatedAt={query.dataUpdatedAt}
            onRefresh={() =>
              void client.invalidateQueries({
                queryKey: ['operations', tenant],
              })
            }
          />
        }
      />
      <main className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <RequestTabs
            active={overdue && tracksDue ? 'overdue' : 'open'}
            open={query.data ? inQueue.length : undefined}
            overdue={
              tracksDue
                ? query.data
                  ? inQueue.filter((request) => request.isOverdue).length
                  : undefined
                : null
            }
            onChange={(tab) =>
              show({ filter: tab === 'overdue' ? 'overdue' : null })
            }
          />
          <Input
            type="search"
            aria-label="Search requests"
            placeholder="Search requests"
            className="ml-auto w-full sm:w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Order"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={oldest ? 'oldest' : 'urgent'}
            onChange={(event) =>
              show({ sort: event.target.value === 'oldest' ? 'oldest' : null })
            }
          >
            <option value="urgent">Most urgent first</option>
            <option value="oldest">Longest waiting first</option>
          </select>
        </div>
        {scopes.length > 1 || scope ? (
          <nav aria-label="Queues" className="flex flex-wrap gap-2 text-xs">
            <QueueChip
              active={!scope}
              label="All queues"
              count={query.data?.requests.length}
              onClick={() => show({ queue: null })}
            />
            {scopes.map((candidate) => (
              <QueueChip
                key={queueKey(candidate)}
                active={candidate === scope}
                label={candidate.queue.name}
                title={`${candidate.queue.name} · ${candidate.queue.workflowName}`}
                count={candidate.queue.count}
                onClick={() => show({ queue: queueKey(candidate) })}
              />
            ))}
            <Link
              className="ml-auto self-center text-primary-text hover:underline"
              to="/operations/queues"
            >
              Manage queues
            </Link>
          </nav>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Could not refresh requests.
            {list.length ? ' Showing the last loaded requests.' : ''} Try
            Refresh.
          </p>
        )}
        {truncated.length ? (
          <p
            role="status"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            Showing the {truncated[0].shown} most urgent of{' '}
            {truncated
              .map(
                ({ queue, total }) =>
                  `${total.toLocaleString()} in ${queue.name}`
              )
              .join(', ')}
            . Search to narrow the list, or{' '}
            <Link
              className="text-primary-text hover:underline"
              to={`/operations/queues/${encodeURIComponent(truncated[0].queue.workflowId)}/${encodeURIComponent(truncated[0].queue.actionKey)}`}
            >
              open the queue
            </Link>{' '}
            to page through all of them.
          </p>
        ) : null}
        <Can permission="workflow:execute">
          <InputRetryPanel matches={() => true} />
        </Can>
        <section
          aria-label="Requests"
          className="overflow-x-auto rounded-lg border bg-background"
        >
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-muted/90 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {['Request', 'Queue', 'Waiting', 'Due', 'Answer'].map(
                  (label) => (
                    <th key={label} className="px-4 py-3 font-semibold">
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => {
                const { row, view } = request;
                const key = requestKey(request);
                const title = requestTitle(request);
                // What the request is about, when its title alone does not say.
                const about = row.message || contextSummary(row.context);
                return (
                  <tr
                    key={key}
                    className={cn(
                      'border-t',
                      key === openKey ? 'bg-primary/5' : 'hover:bg-muted/20'
                    )}
                  >
                    <td className="max-w-80 px-4 py-3">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium text-primary-text hover:underline"
                        aria-label={`Open request ${title}`}
                        title={title}
                        onClick={() => show({ request: key })}
                      >
                        {title}
                      </button>
                      {about ? (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={about}
                        >
                          {about}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      <p className="truncate" title={request.queueName}>
                        {request.queueName}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={request.workflowName}
                      >
                        {request.workflowName}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      <time dateTime={row.requestedAt} title={row.requestedAt}>
                        {formatDistanceToNowStrict(new Date(row.requestedAt))}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      <RequestTiming request={request} />
                    </td>
                    <td className="px-4 py-3">
                      <Can
                        permission="workflow:execute"
                        fallback={
                          <span className="text-muted-foreground">
                            Read only
                          </span>
                        }
                      >
                        <QueueAnswer
                          row={row}
                          inline={view.answers?.inline}
                          infer
                        />
                      </Can>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length ? null : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {/* A failed refresh of a loaded list keeps its empty text
                  (OP-14); the alert above says the refresh failed. */}
              {unavailable
                ? 'Requests unavailable.'
                : query.isPending || !queues.data || !views.data
                  ? 'Loading requests…'
                  : term
                    ? `No requests match “${term}”.`
                    : overdue
                      ? 'Nothing is overdue.'
                      : 'Nothing is waiting. Requests appear here when a run pauses for a person.'}
            </p>
          )}
          {list.length > PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
              <TablePagination
                pageIndex={current}
                pageSize={PAGE_SIZE}
                pageCount={pageCount}
                onPageChange={(next) =>
                  show({ page: next ? String(next + 1) : null })
                }
              />
            </div>
          ) : null}
        </section>
      </main>
      <RequestPanel
        request={openIndex >= 0 ? list[openIndex] : undefined}
        position={
          openIndex >= 0 ? { index: openIndex, count: list.length } : undefined
        }
        onStep={(offset) => {
          const next = list[openIndex + offset];
          if (next) show({ request: requestKey(next) }, true);
        }}
        onClose={() => {
          lastIndex.current = -1;
          show({ request: null });
        }}
      />
    </div>
  );
}

function QueueChip({
  active,
  label,
  title,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      className={cn(
        'rounded-full border px-2.5 py-1 font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary-text'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
    >
      {label}
      <span className="ml-1.5 tabular-nums">
        {count?.toLocaleString() ?? '…'}
      </span>
    </button>
  );
}

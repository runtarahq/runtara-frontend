import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { useCustomQuery } from '@/shared/hooks/api';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useAuthStore } from '@/shared/stores/authStore';
import { Can } from '@/shared/components/Can';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  Breadcrumb,
  ConsoleEmptyState,
  ConsoleTableShell,
  ConsoleToolbar,
  TablePagination,
  TableSkeletonRows,
  TableStatusFooter,
  ToolbarSearch,
} from '@/shared/components/console';
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
import { RequestDetails } from '../components/RequestDetails';
import { QueueAnswer } from '../components/QueueAnswer';
import { RequestPanel, RequestTiming } from '../components/RequestPanel';
import { RequestTabs } from '../components/RequestTabs';
import { RefreshControls } from './shared';
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
  const loading = query.isPending || !queues.data || !views.data;
  return (
    <>
      <ConsoleTableShell
        toolbar={
          <>
            <ConsoleToolbar
              left={
                <Breadcrumb
                  items={[
                    { label: 'Operations', to: '/operations' },
                    { label: 'Requests' },
                  ]}
                />
              }
              search={
                <ToolbarSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search requests…"
                  className="w-56"
                />
              }
            />
            <div className="border-b">
              <RequestTabs
                className="border-b px-4 md:px-7"
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
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-7">
                <ToolbarSelect
                  aria-label="Queue"
                  value={scope ? queueKey(scope) : ''}
                  onChange={(event) =>
                    show({ queue: event.target.value || null })
                  }
                >
                  <option value="">All queues</option>
                  {scopes.map((candidate) => (
                    <option
                      key={queueKey(candidate)}
                      value={queueKey(candidate)}
                    >
                      {candidate.queue.name} · {candidate.queue.workflowName} (
                      {candidate.queue.count})
                    </option>
                  ))}
                </ToolbarSelect>
                <ToolbarSelect
                  aria-label="Order"
                  value={oldest ? 'oldest' : 'urgent'}
                  onChange={(event) =>
                    show({
                      sort: event.target.value === 'oldest' ? 'oldest' : null,
                    })
                  }
                >
                  <option value="urgent">Most urgent first</option>
                  <option value="oldest">Longest waiting first</option>
                </ToolbarSelect>
                <Link
                  className="text-sm text-primary-text hover:underline"
                  to="/operations/queues"
                >
                  Manage queues
                </Link>
                <div className="ml-auto flex items-center gap-3">
                  <RefreshControls
                    busy={
                      query.isFetching || queues.isFetching || views.isFetching
                    }
                    updatedAt={query.dataUpdatedAt}
                    onRefresh={() =>
                      void client.invalidateQueries({
                        queryKey: ['operations', tenant],
                      })
                    }
                  />
                </div>
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="border-b px-4 py-2 text-sm text-destructive md:px-7"
              >
                Could not refresh requests.
                {list.length ? ' Showing the last loaded requests.' : ''} Try
                Refresh.
              </p>
            )}
            {truncated.length ? (
              <p
                role="status"
                className="border-b bg-warning/10 px-4 py-2 text-sm md:px-7"
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
              <div className="px-4 md:px-7">
                <InputRetryPanel matches={() => true} />
              </div>
            </Can>
          </>
        }
        footer={
          <TableStatusFooter
            left={
              <span>
                <strong className="font-semibold text-foreground">
                  {query.data ? list.length.toLocaleString() : '—'}
                </strong>{' '}
                {list.length === 1 ? 'request' : 'requests'}{' '}
                <span className="mx-0.5 text-muted-foreground/60">·</span>{' '}
                {rows.length} on this page
              </span>
            }
            right={
              <TablePagination
                pageIndex={current}
                pageSize={PAGE_SIZE}
                pageCount={pageCount}
                onPageChange={(next) =>
                  show({ page: next ? String(next + 1) : null })
                }
              />
            }
          />
        }
      >
        <section aria-label="Requests" className="h-full">
          {rows.length ? (
            <Table variant="console">
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Answer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((request) => {
                  const { row, view } = request;
                  const key = requestKey(request);
                  const title = requestTitle(request);
                  const origin = `${request.queueName} · ${request.workflowName}`;
                  return (
                    <TableRow
                      key={key}
                      data-state={key === openKey ? 'selected' : undefined}
                    >
                      <TableCell className="max-w-72">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-medium text-primary-text hover:underline"
                          aria-label={`Open request ${title}`}
                          title={title}
                          onClick={() => show({ request: key })}
                        >
                          {title}
                        </button>
                        <p
                          className="mt-1 truncate text-[12.5px] text-muted-foreground"
                          title={origin}
                        >
                          {origin}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-xl">
                        <RequestDetails request={request} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        <time
                          dateTime={row.requestedAt}
                          title={row.requestedAt}
                        >
                          {formatDistanceToNowStrict(new Date(row.requestedAt))}
                        </time>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <RequestTiming request={request} />
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : unavailable ? (
            // A failed refresh of a loaded list keeps its empty text (OP-14);
            // the alert above says the refresh failed.
            <ConsoleEmptyState
              title="Requests unavailable."
              description="Try Refresh."
            />
          ) : loading ? (
            <TableSkeletonRows rows={6} />
          ) : (
            <ConsoleEmptyState
              title={
                term
                  ? `No requests match “${term}”.`
                  : overdue
                    ? 'Nothing is overdue.'
                    : 'Nothing is waiting.'
              }
              description={
                term || overdue
                  ? undefined
                  : 'Requests appear here when a run pauses for a person.'
              }
            />
          )}
        </section>
      </ConsoleTableShell>
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
    </>
  );
}

/** A select drawn as the Runs page draws its own. */
function ToolbarSelect(props: ComponentProps<'select'>) {
  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <select
        {...props}
        className="h-8 w-full min-w-0 appearance-none rounded-md border bg-background pl-3 pr-9 text-sm"
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

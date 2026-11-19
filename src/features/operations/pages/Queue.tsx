import { inlineOptions } from '@/features/operations/utils/answer-options';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useParams } from 'react-router';
import type {
  OperationViewConfig,
  StateFilterDto,
} from '@/generated/RuntaraRuntimeApi';
import { useCustomQuery } from '@/shared/hooks/api';
import { useAuthStore } from '@/shared/stores/authStore';
import { Can } from '@/shared/components/Can';
import { Button } from '@/shared/components/ui/button';
import {
  ConsoleTableShell,
  TablePagination,
} from '@/shared/components/console';
import { InputRetryPanel } from '@/features/workflows/components/ManagedInputSubmissions';
import { useManagedInputSubmissions } from '@/features/workflows/hooks/useManagedInputSubmissions';
import {
  defaultView,
  queryRequests,
  queryRuns,
  resolveQuery,
  useOperations,
} from '@/features/operations/queries';
import type { StateField } from '@/features/runs/components/StateValue';
import type { AnswerController } from '../components/QueueAnswer';
import { DeleteQueue } from '../components/DeleteQueue';
import { QueueBulkBar } from '../components/QueueBulkBar';
import { QueueRequestsTable } from '../components/QueueRequestsTable';
import { QueueToolbar, type QueueTab } from '../components/QueueToolbar';
import { ViewEditor, StateFilters } from '../components/ViewEditor';
import {
  OperationHeader,
  RunRows,
} from '@/features/operations/components/shared';
import { RefreshControls } from '@/features/runs/components/RunActions';
import {
  failedWithNothingToShow,
  refreshFailed,
} from '@/features/operations/utils/poll-errors';
import {
  commonAnswers,
  cycleSort,
  requestKey,
  withOverdue,
} from '@/features/operations/utils/queue-view';

import { queryKeys } from '@/shared/queries/query-keys';
export function QueuePage() {
  const { workflowId, actionKey, viewId: legacyViewId, queueId } = useParams();
  const viewId = queueId ?? legacyViewId;
  const { queues, views, processes } = useOperations();
  const saved = views.data?.find((v) => v.id === viewId);
  const queue = queues.data?.find(
    (q) => q.workflowId === workflowId && q.actionKey === actionKey
  );
  const process = processes.data?.find(
    (p) => p.workflowId === (saved?.configuration.workflow ?? workflowId)
  );
  const initial =
    saved?.configuration ??
    (queue
      ? defaultView(queue)
      : !actionKey && process
        ? {
            name: `${process.name} runs`,
            workflow: process.workflowId,
            columns: Object.keys(process.stateSchema ?? {}).slice(0, 29),
            where: {},
            roles: {},
            answers: {},
            formats: {},
          }
        : undefined);
  // A failed poll keeps the loaded page, and what was typed into it (OP-1).
  if (failedWithNothingToShow(queues, views, processes))
    return (
      <p role="alert" className="p-6">
        Could not load queue. Refresh to try again.
      </p>
    );
  if (!initial)
    return (
      <div className="p-6">
        {queues.isPending || views.isPending || processes.isPending
          ? 'Loading queue…'
          : 'Queue not found.'}
      </div>
    );
  return (
    <>
      {refreshFailed(queues, views, processes) && (
        <div className="px-6 pt-4">
          <p
            role="status"
            className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            Could not refresh the queue. Showing what was last loaded; it will
            retry.
          </p>
        </div>
      )}
      <QueueContent
        key={viewId ?? `${workflowId}/${actionKey}`}
        initial={initial}
        schema={process?.stateSchema ?? queue?.stateSchema ?? {}}
        saved={saved}
        workflowName={process?.name}
      />
    </>
  );
}

function QueueContent({
  initial,
  schema,
  saved,
  workflowName,
}: {
  initial: OperationViewConfig;
  schema: Record<string, StateField>;
  saved?: import('@/generated/RuntaraRuntimeApi').SavedOperationView;
  workflowName?: string;
}) {
  const [view, setView] = useState(initial);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<QueueTab>('open');
  const refs = useRef(new Map<string, AnswerController>());
  const tenant = useAuthStore((s) => s.orgId);
  const navigate = useNavigate();
  const submissions = useManagedInputSubmissions();
  const isQueue = Boolean(view.where?.openRequest);
  const bulk = Boolean(
    view.answers?.bulk && (!saved || Boolean(view.answers.inline))
  );
  const due = view.roles?.due;
  const overdueTab = isQueue && Boolean(due) && tab === 'overdue';
  const query = useCustomQuery({
    queryKey: queryKeys.operations.items(
      tenant,
      view,
      page,
      search,
      overdueTab
    ),
    queryFn: async () =>
      isQueue
        ? {
            requests: await queryRequests(
              overdueTab ? withOverdue(view) : view,
              page,
              search
            ),
            runs: null,
          }
        : {
            requests: null,
            runs: await queryRuns({
              ...resolveQuery(view),
              search,
              page,
              size: 25,
            }),
          },
    refetchInterval: 10_000,
    placeholderData: undefined,
  });
  // Tab counts, the same way the Overview counts overdue requests.
  const counts = useCustomQuery({
    queryKey: queryKeys.operations.queueCounts(tenant, view),
    queryFn: async () => {
      const [open, overdue] = await Promise.all([
        queryRequests(view, 0, '', 1),
        queryRequests(withOverdue(view), 0, '', 1),
      ]);
      return { open: open.totalElements, overdue: overdue.totalElements };
    },
    enabled: isQueue && Boolean(due),
    refetchInterval: 10_000,
    placeholderData: undefined,
  });
  const rows = query.data?.requests?.content ?? [];
  const selected = rows.filter(
    (row) =>
      selection.has(requestKey(row)) &&
      !submissions.inputs.some(
        (i) =>
          i.request.instanceId === row.instanceId &&
          i.request.requestId === row.requestId
      )
  );
  // A row only has a prepared answer once its form is open; say so rather
  // than doing nothing when none is (OP-5).
  async function submitPrepared() {
    const sent = await Promise.all(
      selected.map((row) => refs.current.get(requestKey(row))?.submit())
    );
    if (!sent.some(Boolean))
      toast.info(
        "No prepared answers to submit. Choose an answer or open a row's form first."
      );
  }
  const options = selected.map((row) =>
    inlineOptions(row.inputSchema, view.answers?.inline, !saved)
  );
  const common = commonAnswers(options);
  const data = query.data?.requests ?? query.data?.runs;
  const total = data?.totalElements;
  // Answering or finishing everything on the last page empties it; step back to
  // the new last page instead of stranding an empty table (OP-6).
  const pageCount = data?.totalPages;
  useEffect(() => {
    if (pageCount !== undefined && page > 0 && page >= pageCount)
      setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  function filters(state: StateFilterDto[]) {
    setView((v) => ({ ...v, where: { ...v.where, state } }));
    setPage(0);
    setSelection(new Set());
  }
  const goPage = (next: number) => {
    setPage(next);
    setSelection(new Set());
  };
  // Header sorting cycles ascending, descending, then back to the default.
  const sortBy = (field: string) => {
    setView((v) => ({ ...v, sort: cycleSort(v.sort, field) }));
    goPage(0);
  };
  const tabs = [
    { key: 'open' as const, label: 'Open', count: counts.data?.open ?? total },
    ...(due
      ? [
          {
            key: 'overdue' as const,
            label: 'Overdue',
            count: counts.data?.overdue,
          },
        ]
      : []),
  ];
  return (
    <ConsoleTableShell
      className="mx-auto h-auto max-h-none min-h-full w-full max-w-[1600px] overflow-visible p-5 lg:px-10 lg:py-7"
      bodyClassName="flex-none rounded-lg border"
      toolbar={
        <>
          <OperationHeader
            title={view.name}
            section="Queues"
            description={
              workflowName ? (
                <Link
                  className="hover:text-foreground hover:underline"
                  to={`/workflows/${view.workflow}`}
                >
                  {workflowName}
                </Link>
              ) : isQueue ? (
                'Requests waiting for a decision.'
              ) : (
                'Follow runs and their published state.'
              )
            }
            actions={
              <>
                <RefreshControls
                  compact
                  updatedAt={query.dataUpdatedAt}
                  busy={query.isFetching}
                  onRefresh={() => {
                    void query.refetch();
                    void counts.refetch();
                  }}
                />
                <Can permission="workflow:update">
                  {saved ? (
                    <>
                      <Button asChild variant="secondary">
                        <Link to={`/operations/queues/${saved.id}/edit`}>
                          Edit queue
                        </Link>
                      </Button>
                      <DeleteQueue
                        queue={saved}
                        icon
                        onDeleted={() => navigate('/operations/queues')}
                      />
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => setEditing((value) => !value)}
                    >
                      Create queue
                    </Button>
                  )}
                </Can>
              </>
            }
          />
          <QueueToolbar
            isQueue={isQueue}
            tabs={tabs}
            activeTab={overdueTab ? 'overdue' : 'open'}
            onTab={(next) => {
              setTab(next);
              goPage(0);
            }}
            total={total}
            search={search}
            onSearch={(next) => {
              setSearch(next);
              goPage(0);
            }}
            filtersOpen={filtersOpen}
            filterCount={view.where?.state?.length ?? 0}
            onToggleFilters={() => setFiltersOpen((v) => !v)}
            sort={view.sort}
            onSort={(sort) => {
              setView((v) => ({ ...v, sort }));
              goPage(0);
            }}
            schema={schema}
          />
        </>
      }
      footer={
        (data?.totalPages ?? 0) > 1 ? (
          <div className="flex justify-end py-3">
            <TablePagination
              pageIndex={page}
              pageSize={25}
              pageCount={data?.totalPages ?? 0}
              onPageChange={goPage}
            />
          </div>
        ) : undefined
      }
    >
      {editing ? (
        <Can permission="workflow:update">
          <ViewEditor
            initial={view}
            saved={saved}
            schema={schema}
            onCancel={() => setEditing(false)}
            onSaved={(result) => {
              setEditing(false);
              setView(result.configuration);
              navigate(`/operations/queues/${result.id}`);
            }}
          />
        </Can>
      ) : null}
      {filtersOpen ? (
        <div className="border-b p-6">
          <StateFilters
            filters={view.where?.state ?? []}
            fields={Object.keys(schema)}
            schema={schema}
            onChange={filters}
          />
        </div>
      ) : null}
      <Can permission="workflow:execute">
        <div className="px-6">
          <InputRetryPanel
            matches={(request) => request.workflowId === view.workflow}
          />
        </div>
      </Can>
      {isQueue && bulk && selected.length ? (
        <Can permission="workflow:execute">
          <QueueBulkBar
            count={selected.length}
            common={common}
            onChoose={(value) =>
              void Promise.all(
                selected.map((row) =>
                  refs.current.get(requestKey(row))?.choose(value)
                )
              )
            }
            onSubmit={() => void submitPrepared()}
            onClear={() => setSelection(new Set())}
          />
        </Can>
      ) : null}
      {query.error ? (
        <p role="alert" className="p-6 text-destructive">
          Could not load this view. Check its filters or refresh to try again.
        </p>
      ) : query.isPending ? (
        <p className="p-6">Loading…</p>
      ) : isQueue ? (
        <QueueRequestsTable
          rows={rows}
          view={view}
          schema={schema}
          bulk={bulk}
          inferAnswers={!saved}
          selection={selection}
          onSelectionChange={setSelection}
          onSort={sortBy}
          onAnswerController={(key, controller) => {
            if (controller) refs.current.set(key, controller);
            else refs.current.delete(key);
          }}
        />
      ) : (
        <RunRows
          rows={query.data?.runs?.content ?? []}
          view={view}
          schema={schema}
        />
      )}
      {!query.isPending && !query.error && (data?.totalElements ?? 0) === 0 ? (
        <p className="p-10 text-center text-muted-foreground">
          {isQueue
            ? 'No requests waiting for an answer.'
            : 'No runs match this view.'}
        </p>
      ) : null}
    </ConsoleTableShell>
  );
}

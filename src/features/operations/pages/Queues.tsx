import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import type {
  OperationQueue,
  SavedOperationView,
} from '@/generated/RuntaraRuntimeApi';
import { useCustomQuery } from '@/shared/hooks/api';
import { useAuthStore } from '@/shared/stores/authStore';
import { Can } from '@/shared/components/Can';
import { Button } from '@/shared/components/ui/button';
import { WithTooltip } from '@/shared/components/ui/tooltip';
import { queryRequests, useOperations } from '../queries';
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
  TableSkeletonRows,
  TableStatusFooter,
} from '@/shared/components/console';
import { RefreshControls } from './shared';

const builtInPath = (queue: OperationQueue) =>
  `/operations/queues/${encodeURIComponent(queue.workflowId)}/${encodeURIComponent(queue.actionKey)}`;

/**
 * Every queue there is: one per workflow step that waits on a person, as the
 * workflows define them, then the ones the team made by narrowing or
 * restyling those. Saved lists of runs are kept apart: they hold no requests.
 */
export function QueuesPage() {
  const { queues, views, processes } = useOperations();
  const tenant = useAuthStore((s) => s.orgId);
  const client = useQueryClient();
  const custom = (views.data ?? []).filter(
    (view) => view.configuration.where?.openRequest
  );
  const runLists = (views.data ?? []).filter(
    (view) => !view.configuration.where?.openRequest
  );
  // A custom queue's filters decide its count, so each is asked for its own.
  const counts = useCustomQuery({
    queryKey: [
      'operations',
      tenant,
      'custom-queue-counts',
      custom.map((view) => `${view.id}/${view.revision}`),
    ],
    queryFn: async (token: string) =>
      Object.fromEntries(
        await Promise.all(
          custom.map(async (view) => [
            view.id,
            (await queryRequests(token, view.configuration, 0, '', 1))
              .totalElements,
          ])
        )
      ) as Record<string, number>,
    enabled: custom.length > 0,
    refetchInterval: 30_000,
    placeholderData: undefined,
  });
  const workflowName = (id: string) =>
    processes.data?.find((workflow) => workflow.workflowId === id)?.name ?? id;
  const builtIn = [...(queues.data ?? [])].sort(
    (a, b) =>
      b.count - a.count ||
      a.workflowName.localeCompare(b.workflowName) ||
      a.name.localeCompare(b.name)
  );
  const rows: QueueRowData[] = [
    ...builtIn.map((queue) => ({
      key: `${queue.workflowId}/${queue.actionKey}`,
      to: builtInPath(queue),
      name: queue.name,
      workflow: queue.workflowName,
      kind: 'Workflow step',
      count: queue.count,
    })),
    ...custom.map((view) => ({
      key: view.id,
      to: `/operations/queues/${view.id}`,
      name: view.configuration.name,
      workflow: workflowName(view.configuration.workflow),
      kind: 'Custom',
      count: counts.data?.[view.id],
      edit: view,
    })),
    ...runLists.map((view) => ({
      key: view.id,
      to: `/operations/queues/${view.id}`,
      name: view.configuration.name,
      workflow: workflowName(view.configuration.workflow),
      kind: 'Run list',
      count: null,
      edit: view,
    })),
  ];
  const error = queues.error || views.error;
  const loading = queues.isPending || views.isPending;
  return (
    <ConsoleTableShell
      toolbar={
        <>
          <ConsoleToolbar
            left={
              <>
                <Breadcrumb
                  items={[
                    { label: 'Operations', to: '/operations' },
                    { label: 'Queues' },
                  ]}
                />
                <span className="ml-1 hidden truncate text-[13px] text-muted-foreground lg:inline">
                  One per workflow step that waits on a person, plus the ones
                  your team made.
                </span>
              </>
            }
            actions={
              <Can permission="workflow:update">
                <Button asChild>
                  <Link to="/operations/queues/new">
                    <Plus className="size-4" />
                    Create queue
                  </Link>
                </Button>
              </Can>
            }
          />
          <div className="flex flex-wrap items-center justify-end gap-3 border-b px-4 py-3 md:px-7">
            <RefreshControls
              updatedAt={queues.dataUpdatedAt}
              busy={queues.isFetching || views.isFetching}
              onRefresh={() =>
                void client.invalidateQueries({ queryKey: ['operations'] })
              }
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="border-b px-4 py-2 text-sm text-destructive md:px-7"
            >
              Could not load queues. Try Refresh.
            </p>
          ) : null}
        </>
      }
      footer={
        <TableStatusFooter
          left={
            <span>
              <strong className="font-semibold text-foreground">
                {loading ? '—' : rows.length}
              </strong>{' '}
              {rows.length === 1 ? 'queue' : 'queues'}
            </span>
          }
        />
      }
    >
      {rows.length ? (
        <Table variant="console">
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Open requests</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-80">
                  <Link
                    className="block truncate font-medium text-primary-text hover:underline"
                    title={row.name}
                    to={row.to}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="max-w-80 truncate text-muted-foreground">
                  {row.workflow}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.kind}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.count === null ? (
                    <span
                      className="text-muted-foreground"
                      title="A run list holds runs, not requests"
                    >
                      —
                    </span>
                  ) : row.count === undefined ? (
                    <span className="text-muted-foreground">…</span>
                  ) : (
                    <span
                      className={
                        row.count ? 'font-semibold' : 'text-muted-foreground'
                      }
                    >
                      {row.count.toLocaleString()}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {row.edit ? (
                    <Can permission="workflow:update">
                      <WithTooltip label="Edit queue">
                        <Button
                          asChild
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8"
                        >
                          <Link
                            aria-label={`Edit queue ${row.edit.configuration.name}`}
                            to={`/operations/queues/${row.edit.id}/edit`}
                          >
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                      </WithTooltip>
                    </Can>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : loading ? (
        <TableSkeletonRows rows={6} />
      ) : error ? null : (
        <ConsoleEmptyState
          title="No queues yet."
          description="A queue appears here for each workflow step that asks a person for an answer."
        />
      )}
    </ConsoleTableShell>
  );
}

interface QueueRowData {
  key: string;
  to: string;
  name: string;
  workflow: string;
  kind: string;
  /** Open requests; null for a list of runs, undefined while counting. */
  count?: number | null;
  /** The saved queue, when the row can be edited. */
  edit?: SavedOperationView;
}

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
import { OperationHeader, OperationSection, RefreshControls } from './shared';

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
  return (
    <div className="mx-auto min-h-full w-full max-w-[1600px] bg-background p-5 lg:px-10 lg:py-7">
      <OperationHeader
        title="Queues"
        description="One queue for every workflow step that waits on a person, plus the ones your team made."
        actions={
          <>
            <RefreshControls
              updatedAt={queues.dataUpdatedAt}
              busy={queues.isFetching || views.isFetching}
              onRefresh={() =>
                void client.invalidateQueries({ queryKey: ['operations'] })
              }
            />
            <Can permission="workflow:update">
              <Button asChild>
                <Link to="/operations/queues/new">
                  <Plus className="size-4" />
                  Create queue
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <main className="space-y-5">
        <OperationSection title="Workflow queues">
          <ul className="divide-y">
            {builtIn.map((queue) => (
              <QueueRow
                key={`${queue.workflowId}/${queue.actionKey}`}
                to={builtInPath(queue)}
                name={queue.name}
                detail={queue.workflowName}
                count={queue.count}
              />
            ))}
          </ul>
          {queues.error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              Could not load queues. Try Refresh.
            </p>
          ) : queues.isPending ? (
            <p className="p-4 text-sm">Loading queues…</p>
          ) : !builtIn.length ? (
            <div className="space-y-2 p-5 text-sm">
              <p>No workflow waits on a person yet.</p>
              <p className="text-muted-foreground">
                A queue appears here for each workflow step that asks for an
                answer.
              </p>
            </div>
          ) : null}
        </OperationSection>
        <OperationSection title="Custom queues">
          <ul className="divide-y">
            {custom.map((view) => (
              <QueueRow
                key={view.id}
                to={`/operations/queues/${view.id}`}
                name={view.configuration.name}
                detail={workflowName(view.configuration.workflow)}
                count={counts.data?.[view.id]}
                edit={view}
              />
            ))}
          </ul>
          {views.error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              Could not load custom queues. Try Refresh.
            </p>
          ) : views.isPending ? (
            <p className="p-4 text-sm">Loading queues…</p>
          ) : !custom.length ? (
            <div className="space-y-2 p-5 text-sm">
              <p>No custom queues yet.</p>
              <p className="text-muted-foreground">
                Create one to show part of a workflow queue, choose its columns,
                or track when its requests are due.
              </p>
            </div>
          ) : null}
        </OperationSection>
        {runLists.length ? (
          <OperationSection title="Saved run lists">
            <ul className="divide-y">
              {runLists.map((view) => (
                <QueueRow
                  key={view.id}
                  to={`/operations/queues/${view.id}`}
                  name={view.configuration.name}
                  detail={`${workflowName(view.configuration.workflow)} · runs, not requests`}
                  edit={view}
                />
              ))}
            </ul>
          </OperationSection>
        ) : null}
      </main>
    </div>
  );
}

function QueueRow({
  to,
  name,
  detail,
  count,
  edit,
}: {
  to: string;
  name: string;
  detail: string;
  /** Open requests; left out for a list of runs. */
  count?: number;
  /** The saved queue, when the row can be edited. */
  edit?: SavedOperationView;
}) {
  return (
    <li className="flex min-w-0 items-center gap-4 px-4 py-3">
      <Link className="min-w-0 flex-1 hover:text-primary-text" to={to}>
        <h3 className="truncate text-sm font-medium" title={name}>
          {name}
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </Link>
      {count === undefined ? null : (
        <span
          className={`shrink-0 text-sm tabular-nums ${count ? 'font-semibold' : 'text-muted-foreground'}`}
          aria-label={`${count} open requests`}
        >
          {count.toLocaleString()}{' '}
          <span className="text-xs font-normal text-muted-foreground">
            open
          </span>
        </span>
      )}
      {edit ? (
        <Can permission="workflow:update">
          <WithTooltip label="Edit queue">
            <Button
              asChild
              variant="secondary"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
            >
              <Link
                aria-label={`Edit queue ${edit.configuration.name}`}
                to={`/operations/queues/${edit.id}/edit`}
              >
                <Pencil className="size-4" />
              </Link>
            </Button>
          </WithTooltip>
        </Can>
      ) : (
        // Keeps the counts in one column across both kinds of row.
        <span className="w-8 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}

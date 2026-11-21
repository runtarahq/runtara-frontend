import type {
  OperationQueue,
  OperationRequest,
  OperationRequestPage,
  OperationViewConfig,
  SavedOperationView,
  QueryExecutionsRequest,
  StateFilterDto,
} from '@/generated/RuntaraRuntimeApi';
import { defaultView, operationsRequest, selectedFields } from './queries';

export interface AttentionRequest {
  row: OperationRequest;
  workflowName: string;
  /** The wait step the request belongs to, as the workflow names it. */
  queueName: string;
  /** How the request's queue presents and answers it. */
  view: OperationViewConfig;
  due?: string;
  isOverdue: boolean;
}
export interface AttentionQueue {
  queue: OperationQueue;
  view: OperationViewConfig;
}

/** Overview and its drilldowns must use the same due role, without saved-view filters. */
export function attentionQueues(
  queues: OperationQueue[],
  views: SavedOperationView[]
): AttentionQueue[] {
  return queues
    .filter((queue) => queue.count > 0)
    .map((queue) => ({
      queue,
      view:
        views.find(
          (v) =>
            v.configuration.workflow === queue.workflowId &&
            v.configuration.where?.openRequest === queue.actionKey &&
            v.configuration.roles?.due
        )?.configuration ?? defaultView(queue),
    }));
}
export function attentionRequest(
  row: OperationRequest,
  { queue, view }: AttentionQueue,
  now: number
): AttentionRequest {
  const value = view.roles?.due ? row.state?.[view.roles.due] : undefined;
  const due =
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? value
      : undefined;
  return {
    row,
    workflowName: queue.workflowName,
    queueName: queue.name,
    view,
    due,
    isOverdue: !!due && Date.parse(due) < now,
  };
}
export function overdueFilters(
  view: OperationViewConfig,
  now: number
): QueryExecutionsRequest['state'] {
  return view.roles?.due
    ? [
        {
          field: view.roles.due,
          op: 'lt',
          value: new Date(
            now
          ).toISOString() as unknown as StateFilterDto['value'],
        },
      ]
    : [];
}

/** The most one queue contributes to the inbox; the server's page limit. */
export const INBOX_QUEUE_LIMIT = 100;

/** When a request has to be acted on: its due time or its expiry, whichever is first. */
export function actBy(request: AttentionRequest): number | undefined {
  const times = [request.due, request.row.deadline]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : undefined;
}

/** Overdue first, then what must be acted on soonest, then the longest waiting. */
export function byUrgency(a: AttentionRequest, b: AttentionRequest): number {
  const [left, right] = [actBy(a), actBy(b)];
  return (
    Number(b.isOverdue) - Number(a.isOverdue) ||
    (left ?? Infinity) - (right ?? Infinity) ||
    a.row.requestedAt.localeCompare(b.row.requestedAt)
  );
}

/**
 * Every open request of the given queues, for one list sorted across them.
 * A queue contributes its most urgent INBOX_QUEUE_LIMIT; `truncated` names
 * the queues that hold more, so the list can say so instead of hiding them.
 */
export async function queryInbox(
  token: string,
  sources: AttentionQueue[],
  search = '',
  now = Date.now()
) {
  const pages = await Promise.all(
    sources.map((scope) =>
      operationsRequest<OperationRequestPage>(
        token,
        'operations/requests/query',
        'POST',
        {
          workflowId: scope.queue.workflowId,
          actionKey: scope.queue.actionKey,
          query: {
            page: 0,
            size: INBOX_QUEUE_LIMIT,
            search: search.trim() || undefined,
            stateFields: selectedFields(scope.view),
            state: [],
            stateSort: scope.view.roles?.due
              ? { field: scope.view.roles.due, descending: false }
              : undefined,
          },
        }
      )
    )
  );
  return {
    requests: pages.flatMap((page, index) =>
      page.content.map((row) => attentionRequest(row, sources[index], now))
    ),
    total: pages.reduce((sum, page) => sum + page.totalElements, 0),
    truncated: sources
      .map((scope, index) => ({
        queue: scope.queue,
        total: pages[index].totalElements,
        shown: pages[index].content.length,
      }))
      .filter(({ total, shown }) => total > shown),
  };
}

/** What a request is called in a list: its queue's key field, its run label, or a short run id. */
export function requestTitle({ row, view }: AttentionRequest): string {
  const key = view.roles?.key ? row.state?.[view.roles.key] : undefined;
  return String(key ?? row.runLabel ?? row.instanceId.slice(0, 8));
}

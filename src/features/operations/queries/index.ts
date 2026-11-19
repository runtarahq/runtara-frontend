import { useCustomQuery } from '@/shared/hooks/api';
import { useAuthStore } from '@/shared/stores/authStore';
import type {
  OperationProcess,
  OperationQueue,
  OperationRequestPage,
  OperationViewConfig,
  SavedOperationView,
  QueryExecutionsRequest,
  PageWorkflowInstanceHistoryDto,
} from '@/generated/RuntaraRuntimeApi';

import { queryKeys } from '@/shared/queries/query-keys';
import { operationsRequest } from '@/features/runs/queries';
export function useOperations({ includeProcesses = true } = {}) {
  const tenant = useAuthStore((s) => s.orgId);
  const queues = useCustomQuery({
    queryKey: queryKeys.operations.queues(tenant),
    queryFn: () => operationsRequest<OperationQueue[]>('operations/queues'),
    refetchInterval: 10_000,
    placeholderData: undefined,
  });
  const views = useCustomQuery({
    queryKey: queryKeys.operations.views(tenant),
    queryFn: () => operationsRequest<SavedOperationView[]>('operations/views'),
    placeholderData: undefined,
  });
  const processes = useCustomQuery({
    queryKey: queryKeys.operations.processes(tenant),
    enabled: includeProcesses,
    queryFn: () =>
      operationsRequest<OperationProcess[]>('operations/processes'),
    placeholderData: undefined,
  });
  return { queues, views, processes };
}
export function defaultView(queue: OperationQueue): OperationViewConfig {
  return {
    name: queue.name,
    workflow: queue.workflowId,
    columns: Object.keys(queue.stateSchema ?? {}).slice(0, 29),
    where: { openRequest: queue.actionKey, state: [] },
    roles: {},
    answers: { bulk: true },
    formats: {},
    labels: {},
  };
}
export function selectedFields(view: OperationViewConfig): string[] {
  return [
    ...new Set(
      [
        ...(view.columns ?? []),
        view.roles?.key,
        view.roles?.stage,
        view.roles?.due,
      ].filter((s): s is string => Boolean(s))
    ),
  ];
}
/** Re-evaluate relative time on every poll, without changing saved filters. */
export function resolveQuery(
  view: OperationViewConfig,
  now = Date.now()
): QueryExecutionsRequest {
  return {
    workflowId: view.workflow,
    stateFields: selectedFields(view),
    stateSort: view.sort,
    status: view.where?.status,
    state: (view.where?.state ?? []).map((f) => {
      const value = f.value as unknown;
      if (
        value &&
        typeof value === 'object' &&
        'relative' in value &&
        value.relative === 'now'
      ) {
        const offset =
          'offsetSeconds' in value ? Number(value.offsetSeconds) : 0;
        return {
          ...f,
          value: new Date(
            now + offset * 1000
          ).toISOString() as unknown as typeof f.value,
        };
      }
      return f;
    }),
  };
}
export function queryRequests(
  view: OperationViewConfig,
  page: number,
  search: string,
  size = 25
) {
  return operationsRequest<OperationRequestPage>(
    'operations/requests/query',
    'POST',
    {
      workflowId: view.workflow,
      actionKey: view.where?.openRequest,
      query: {
        ...resolveQuery(view),
        page,
        size,
        search: search || undefined,
      },
    }
  );
}
export function queryRuns(query: QueryExecutionsRequest) {
  return operationsRequest<PageWorkflowInstanceHistoryDto>(
    'executions/query',
    'POST',
    query
  );
}
export function failureText(
  summary:
    | import('@/generated/RuntaraRuntimeApi').OperationErrorSummary
    | null
    | undefined,
  fallback?: string | null
): string {
  if (!summary) return fallback ?? 'No error details recorded';
  if (
    !summary.code ||
    !['transient', 'permanent'].includes(summary.category ?? '')
  )
    return summary.message;
  return JSON.stringify({
    ...summary,
    severity: summary.severity ?? 'error',
    attributes: {},
  });
}

/** Whether a request failed because the saved view moved to a new revision. */
export function isRevisionConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } }).response?.status === 409;
}

/**
 * The saved view's current revision, read fresh from the server. After a
 * revision conflict the user has seen the error; their next attempt should go
 * against this revision instead of repeating the refused one (OP-11, OP-12).
 */
export async function currentRevision(id: string): Promise<number | undefined> {
  const views =
    await operationsRequest<SavedOperationView[]>('operations/views');
  return views.find((view) => view.id === id)?.revision;
}

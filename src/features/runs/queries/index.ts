import { RuntimeREST } from '@/shared/queries';

/**
 * Calls a runtime route that answers in the `{ data }` envelope, and returns
 * what is in it. `path` is the part after `/api/runtime/`. The operations
 * routes and the run routes they share with the history all answer this way.
 */
export async function operationsRequest<T>(
  path: string,
  method = 'GET',
  data?: unknown
): Promise<T> {
  const response = await RuntimeREST.instance.request<{ data: T }>({
    url: `/api/runtime/${path}`,
    method,
    data,
  });
  return response.data.data;
}

/** What to tell the user a request failed with. */
export function message(error: unknown): string {
  const e = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return (
    e.response?.data?.message ?? e.message ?? 'The request failed. Try again.'
  );
}

/** Present a readable failure, including terminal errors without step events. */
export function describeFailure(
  run: Pick<
    import('@/generated/RuntaraRuntimeApi').WorkflowInstanceDto,
    'error' | 'errorSummary'
  >
): { message: string; code?: string | null; category?: string | null } {
  if (run.errorSummary) return run.errorSummary;
  try {
    const value: unknown = JSON.parse(run.error ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof value.message === 'string'
    ) {
      return {
        message: value.message,
        code:
          'code' in value && typeof value.code === 'string'
            ? value.code
            : undefined,
        category:
          'category' in value && typeof value.category === 'string'
            ? value.category
            : undefined,
      };
    }
  } catch {
    /* Host failures may be plain text. */
  }
  return { message: run.error || 'No error details recorded' };
}

export async function queryRunSummary(
  filters: import('@/generated/RuntaraRuntimeApi').ExecutionSummaryRequest
) {
  return operationsRequest<
    import('@/generated/RuntaraRuntimeApi').ExecutionSummary
  >('executions/summary', 'POST', filters);
}

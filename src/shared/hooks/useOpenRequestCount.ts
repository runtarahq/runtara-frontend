import type { OperationQueue } from '@/generated/RuntaraRuntimeApi';
import { RuntimeREST } from '@/shared/queries';
import { createAuthHeaders } from '@/shared/queries/utils';
import { useAuthStore } from '@/shared/stores/authStore';
import { useCustomQuery } from './api';

/**
 * How many requests wait on a person, across all workflows: the number the
 * navigation shows beside Requests. It reads the same cached queue list as
 * the Operations pages, so the two never disagree.
 */
export function useOpenRequestCount(): number | undefined {
  const tenant = useAuthStore((s) => s.orgId);
  const queues = useCustomQuery({
    queryKey: ['operations', tenant, 'queues'],
    queryFn: async (token: string) =>
      (
        await RuntimeREST.instance.request<{ data: OperationQueue[] }>({
          url: '/api/runtime/operations/queues',
          method: 'GET',
          ...createAuthHeaders(token),
        })
      ).data.data,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: undefined,
  });
  return queues.data?.reduce((sum, queue) => sum + queue.count, 0);
}

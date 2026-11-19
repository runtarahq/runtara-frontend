import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/shared/queries/query-keys';

/**
 * Refreshes the lists of runs when the run this page started begins, and
 * each time its status changes. The History panel polls its list every ten
 * seconds, so a run that had just started or finished was missing from it,
 * or shown in its old state, until the next poll.
 */
export function useRefreshRunsOnStatus(
  instanceId: string | null | undefined,
  status: string | null | undefined
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!instanceId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.executions.lists(),
    });
  }, [instanceId, status, queryClient]);
}

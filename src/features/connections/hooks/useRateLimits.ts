import { useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import {
  getRateLimits,
  getConnectionRateLimitStatus,
  getConnectionRateLimitHistory,
  getConnectionRateLimitTimeline,
  type RateLimitHistoryParams,
  type RateLimitTimelineParams,
} from '../queries/rateLimits';

export function useRateLimits(interval?: string) {
  return useCustomQuery({
    queryKey: ['analytics', 'rateLimits', interval],
    queryFn: (token: string) => getRateLimits(token, interval),
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}

/** Live rate-limit status for a single connection (config + Redis state). */
export function useConnectionRateLimitStatus(
  connectionId: string | null | undefined
) {
  return useCustomQuery({
    queryKey: ['analytics', 'rateLimitStatus', connectionId],
    queryFn: (token: string) =>
      getConnectionRateLimitStatus(token, connectionId!),
    enabled: !!connectionId,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}

/**
 * The timeline for the `rangeMs` ending now. The window is taken at each
 * fetch and returned with the data, so a poll moves it forward and the chart
 * buckets the same window it fetched; computed once, every 30-second poll
 * asked for the same past window (AN-2).
 */
export function useConnectionRateLimitTimeline(
  params: Pick<RateLimitTimelineParams, 'granularity' | 'tag'> & {
    connectionId: string | null;
    dateRange: string;
    rangeMs: number;
  }
) {
  const { connectionId, dateRange, rangeMs, ...query } = params;
  return useCustomQuery({
    queryKey: queryKeys.analytics.rateLimitTimeline(
      connectionId ?? '',
      dateRange
    ),
    queryFn: async (token: string) => {
      const window = currentWindow(rangeMs);
      const response = await getConnectionRateLimitTimeline(token, {
        connectionId: connectionId!,
        startTime: window.start.toISOString(),
        endTime: window.end.toISOString(),
        ...query,
      });
      return { ...response, window };
    },
    enabled: !!connectionId,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}

/** Events in the `rangeMs` ending now, taken at each fetch as above. */
export function useConnectionRateLimitHistory(
  params: Pick<RateLimitHistoryParams, 'limit'> & {
    connectionId: string | null;
    rangeMs: number;
  }
) {
  const { connectionId, rangeMs, limit } = params;
  return useCustomQuery({
    queryKey: ['analytics', 'rateLimitHistory', connectionId, rangeMs, limit],
    queryFn: (token: string) =>
      getConnectionRateLimitHistory(token, {
        connectionId: connectionId!,
        from: currentWindow(rangeMs).start.toISOString(),
        limit,
      }),
    enabled: !!connectionId,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function currentWindow(rangeMs: number) {
  const end = new Date();
  return { start: new Date(end.getTime() - rangeMs), end };
}

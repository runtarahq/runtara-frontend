import { RuntimeREST } from '@/shared/queries';

export async function getRateLimits(interval?: string) {
  const result = await RuntimeREST.api.listRateLimitsHandler(
    interval ? { interval } : undefined
  );
  return result.data;
}

export async function getConnectionRateLimitStatus(connectionId: string) {
  const result =
    await RuntimeREST.api.getConnectionRateLimitStatusHandler(connectionId);
  return result.data;
}

export interface RateLimitHistoryParams {
  connectionId: string;
  limit?: number;
  offset?: number;
  eventType?: string;
  from?: string;
  to?: string;
}

export async function getConnectionRateLimitHistory(
  params: RateLimitHistoryParams
) {
  const { connectionId, ...query } = params;
  const result = await RuntimeREST.api.getConnectionRateLimitHistoryHandler(
    connectionId,
    {
      limit: query.limit,
      offset: query.offset,
      event_type: query.eventType,
      from: query.from,
      to: query.to,
    }
  );
  return result.data;
}

export interface RateLimitTimelineParams {
  connectionId: string;
  startTime?: string;
  endTime?: string;
  granularity?: 'minute' | 'hourly' | 'daily';
  tag?: string;
}

export async function getConnectionRateLimitTimeline(
  params: RateLimitTimelineParams
) {
  const { connectionId, ...query } = params;
  const result = await RuntimeREST.api.getConnectionRateLimitTimelineHandler(
    connectionId,
    {
      startTime: query.startTime,
      endTime: query.endTime,
      granularity: query.granularity,
      tag: query.tag,
    }
  );
  return result.data;
}

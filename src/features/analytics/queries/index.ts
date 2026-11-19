import { RuntimeREST } from '@/shared/queries';

// Re-export relevant DTOs from the generated Runtime API for easier access
export type {
  TenantMetricsResponse,
  TenantMetricsData,
  MetricsBucket,
  WorkflowMetricsHourlyResponse,
  WorkflowMetricsHourlyData,
  WorkflowMetricsHourly,
  WorkflowMetricsDaily,
  WorkflowMetricsDailyResponse,
  WorkflowMetricsData,
  WorkflowStatsResponse,
  WorkflowStatsData,
  WorkflowStats,
  SystemAnalyticsResponse,
  SystemAnalyticsData,
  CpuInfo,
  DiskInfo,
  MemoryInfo,
} from '@/generated/RuntaraRuntimeApi';

/**
 * Get tenant-level metrics aggregated across all workflows
 * @param token - Authentication token
 * @param startTime - Start time in ISO 8601 format
 * @param endTime - End time in ISO 8601 format
 * @param granularity - Bucket width: 'hourly', 'daily', or a width such as
 *   '6m' or '2h'. Sent explicitly rather than omitted, which the API reads as
 *   hourly - so a 90-day window used to come back as 2161 buckets.
 */
export async function getTenantMetrics(
  startTime: string,
  endTime: string,
  granularity: string
) {
  const result = await RuntimeREST.api.getTenantMetrics({
    startTime,
    endTime,
    granularity,
  });
  return result.data;
}

/**
 * Get system analytics including memory, disk space, and CPU information
 * @param token - Authentication token
 */
export async function getSystemAnalytics() {
  const result = await RuntimeREST.api.getSystemAnalyticsHandler();
  return result.data;
}

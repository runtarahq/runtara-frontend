// Switch match type mapping: UI lowercase <-> API uppercase
const MATCH_TYPE_UI_TO_API: Record<string, string> = {
  exact: 'EQ',
  ne: 'NE',
  in: 'IN',
  not_in: 'NOT_IN',
  gt: 'GT',
  gte: 'GTE',
  lt: 'LT',
  lte: 'LTE',
  starts_with: 'STARTS_WITH',
  ends_with: 'ENDS_WITH',
  contains: 'CONTAINS',
  is_defined: 'IS_DEFINED',
  is_empty: 'IS_EMPTY',
  is_not_empty: 'IS_NOT_EMPTY',
  between: 'BETWEEN',
  range: 'RANGE',
};

const MATCH_TYPE_API_TO_UI: Record<string, string> = Object.fromEntries(
  Object.entries(MATCH_TYPE_UI_TO_API).map(([k, v]) => [v, k])
);

export function mapMatchTypeToAPI(matchType: string): string {
  // Already uppercase (from API) → pass through
  if (matchType === matchType.toUpperCase() && matchType.length > 1)
    return matchType;
  return MATCH_TYPE_UI_TO_API[matchType] || matchType.toUpperCase();
}

export function mapMatchTypeFromAPI(matchType: string): string {
  return MATCH_TYPE_API_TO_UI[matchType] || matchType.toLowerCase();
}
/**
 * DSL 3.6 spells millisecond fields with an `Ms` suffix; the old names still
 * parse as deprecated aliases (W093). The editor's form keeps the short
 * names, reads either spelling and saves the canonical one.
 */
export const DURATION_FIELDS = [
  ['timeoutMs', 'timeout'],
  ['retryDelayMs', 'retryDelay'],
  ['turnTimeoutMs', 'turnTimeout'],
] as const;

/** A duration from a step or config, in either spelling. */
export function readDuration(
  source: Record<string, any> | undefined | null,
  canonical: (typeof DURATION_FIELDS)[number][0]
): any {
  const legacy = DURATION_FIELDS.find(([name]) => name === canonical)![1];
  return source?.[canonical] ?? source?.[legacy];
}

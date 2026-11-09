/** The part of a query's state that decides whether its failure blocks. */
type QueryState = { error: unknown; data: unknown };

/**
 * Whether a failure has to replace the page: only when a query failed with
 * nothing to show. A failed poll of a query that loaded keeps its last data,
 * so the page and what the user typed into it stay (OP-1, OP-2).
 */
export function failedWithNothingToShow(...queries: QueryState[]): boolean {
  return queries.some((q) => Boolean(q.error) && q.data === undefined);
}

/** Whether a loaded query's latest refresh failed, so what shows may be stale. */
export function refreshFailed(...queries: QueryState[]): boolean {
  return queries.some((q) => Boolean(q.error) && q.data !== undefined);
}

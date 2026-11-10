/**
 * What the run history page shows for its query state.
 *
 * The loader is only for a first load still in progress: once that load has
 * failed there is nothing to wait for, so the error shows instead (HI-1). A
 * failed poll of a loaded run keeps the page, and what was typed into it
 * (HI-2); the page notes that the refresh failed.
 */
export function historyView({
  hasData,
  isLoading,
  isError,
  isInitialLoad,
}: {
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  isInitialLoad: boolean;
}): 'loader' | 'error' | 'content' {
  if ((isLoading || !hasData) && isInitialLoad && !isError) return 'loader';
  if (isError && !hasData) return 'error';
  if (!hasData) return 'loader';
  return 'content';
}

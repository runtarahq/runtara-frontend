import {
  formatCount,
  measurePayload,
  searchPayload,
  type PayloadSize,
  type SearchResult,
} from './model';
import type { PayloadSection } from './types';

// Payloads are immutable once fetched, so search results and sizes are cached
// per value: re-renders (polling, typing elsewhere) never re-walk a payload.
const searchCache = new WeakMap<object, Map<string, SearchResult>>();
const sizeCache = new WeakMap<object, PayloadSize>();

export function cachedSearch(value: unknown, query: string): SearchResult {
  if (typeof value !== 'object' || value === null)
    return searchPayload(value, query);
  let byQuery = searchCache.get(value);
  if (!byQuery) {
    byQuery = new Map();
    searchCache.set(value, byQuery);
  }
  let result = byQuery.get(query);
  if (!result) {
    result = searchPayload(value, query);
    // Keep the last few queries only; each result can hold 1,000 paths.
    if (byQuery.size >= 8)
      byQuery.delete(byQuery.keys().next().value as string);
    byQuery.set(query, result);
  }
  return result;
}

export function cachedSize(value: unknown): PayloadSize {
  if (typeof value !== 'object' || value === null) return measurePayload(value);
  let size = sizeCache.get(value);
  if (!size) {
    size = measurePayload(value);
    sizeCache.set(value, size);
  }
  return size;
}

export function isEmptyValue(value: unknown) {
  return value === null || value === undefined;
}

/** Where else a search found something, for a section it found nothing in. */
export function otherSectionsHint(
  sections: PayloadSection[],
  searches: Record<string, SearchResult>,
  activeId: string
) {
  const elsewhere = sections
    .filter((s) => s.id !== activeId && searches[s.id].matches.length)
    .map(
      (s) =>
        `${formatCount(searches[s.id].matches.length)} in ${s.label.toLowerCase()}`
    );
  return elsewhere.length
    ? `Found ${elsewhere.join(', ')}.`
    : 'Nothing here matches the search.';
}

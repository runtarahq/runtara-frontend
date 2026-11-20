import { stateLabel } from './state-label';

/** One entry of a request's context, as shown to whoever answers it. */
export interface ContextEntry {
  key: string;
  label: string;
  value: unknown;
}

/** Whether a context value says anything: not null, not "", not an empty object or list. */
function hasContent(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>).some(
      ([key, inner]) => key !== '' && hasContent(inner)
    );
  return true;
}

/**
 * What a request's context says, in the order the workflow gave it: the
 * values a workflow put on its wait step (`action.context`) for whoever
 * decides it, such as the tool a builder proposes. Empty values are left out.
 */
export function contextEntries(context: unknown): ContextEntry[] {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return [];
  return Object.entries(context as Record<string, unknown>)
    .filter(([key, value]) => key !== '' && hasContent(value))
    .map(([key, value]) => ({ key, label: stateLabel(key), value }));
}

/** A value on one line: scalars as they are, anything else as compact JSON. */
export function contextText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return JSON.stringify(value);
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A one-line summary of a request's context for a list row: its first few
 * short scalar entries, ids left out, so requests of one queue can be told
 * apart before they are opened.
 */
export function contextSummary(context: unknown, limit = 3): string {
  return contextEntries(context)
    .filter(
      ({ value }) =>
        ['string', 'number', 'boolean'].includes(typeof value) &&
        contextText(value).length <= 60 &&
        !ID.test(contextText(value))
    )
    .slice(0, limit)
    .map(({ label, value }) => `${label}: ${contextText(value)}`)
    .join(' · ');
}

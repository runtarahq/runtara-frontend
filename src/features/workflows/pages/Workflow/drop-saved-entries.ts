/**
 * What is left staged after a save that sent `sent`.
 *
 * An entry is dropped only if it is still the very value that was sent. One
 * edited while the save was in flight was never sent, so it stays staged and
 * the page keeps counting it as unsaved (WF-2).
 */
export function dropSavedEntries<T extends object>(current: T, sent: T): T {
  let changed = false;
  const next = { ...current };
  for (const key of Object.keys(sent) as (keyof T)[]) {
    if (
      Object.prototype.hasOwnProperty.call(next, key) &&
      Object.is(next[key], sent[key])
    ) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : current;
}

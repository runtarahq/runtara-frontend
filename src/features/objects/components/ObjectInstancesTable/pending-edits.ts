/**
 * Inline-edit bookkeeping the grid keeps while a row has unsaved changes.
 * Saves are deferred (queued behind timeouts), so this state can outlive the
 * row it belongs to unless it is pruned when rows are deleted.
 */
export interface PendingEditState {
  /** Unsaved property values keyed by row id. */
  dirtyRows: Map<string, Record<string, unknown>>;
  /** Row that most recently held focus; the next flush targets it. */
  lastFocusedRowId: string | null;
  /** Cell currently in edit mode, as `${rowId}-${columnName}`. */
  editingCellId: string | null;
}

/**
 * Drop pending edit state for rows that are being deleted, so no deferred
 * save can later flush against a row that no longer exists. State for rows
 * outside `deletedIds` is preserved untouched.
 */
export function dropEditsForRows(
  state: PendingEditState,
  deletedIds: string[]
): PendingEditState {
  const deleted = new Set(deletedIds);

  const dirtyRows = new Map(state.dirtyRows);
  deleted.forEach((id) => dirtyRows.delete(id));

  const lastFocusedRowId =
    state.lastFocusedRowId && deleted.has(state.lastFocusedRowId)
      ? null
      : state.lastFocusedRowId;

  // Row ids are fixed-length, so despite the dashes inside a UUID the
  // `${rowId}-` prefix test matches exactly one row's cells.
  const editingCellId =
    state.editingCellId &&
    deletedIds.some((id) => state.editingCellId!.startsWith(`${id}-`))
      ? null
      : state.editingCellId;

  return { dirtyRows, lastFocusedRowId, editingCellId };
}

/**
 * Record a cell edit in the row's unsaved values. A value that matches what the
 * server holds is not a change, so it leaves the row rather than being written
 * back: reverting an edit must leave nothing to flush. Without `serverProperties`,
 * as for a draft with no server copy, every value counts.
 *
 * Returns the same map when nothing changed.
 */
export function recordCellEdit(
  dirtyRows: Map<string, Record<string, unknown>>,
  rowId: string,
  edits: Record<string, unknown>,
  serverProperties?: Record<string, unknown>
): Map<string, Record<string, unknown>> {
  const before = dirtyRows.get(rowId);
  const row = { ...before };
  let changed = false;

  for (const [key, value] of Object.entries(edits)) {
    if (serverProperties && Object.is(serverProperties[key], value)) {
      if (key in row) {
        delete row[key];
        changed = true;
      }
    } else if (!(key in row) || !Object.is(row[key], value)) {
      row[key] = value;
      changed = true;
    }
  }

  if (!changed) return dirtyRows;

  const next = new Map(dirtyRows);
  if (Object.keys(row).length > 0) next.set(rowId, row);
  else next.delete(rowId);
  return next;
}

/**
 * Settle a row after a save of `sent` succeeded: drop the values it carried,
 * and keep any typed while it was in flight, so they are still unsaved and the
 * next flush sends them.
 *
 * Returns the same map when nothing changed.
 */
export function settleSavedRow(
  dirtyRows: Map<string, Record<string, unknown>>,
  rowId: string,
  sent: Record<string, unknown>
): Map<string, Record<string, unknown>> {
  const current = dirtyRows.get(rowId);
  if (!current) return dirtyRows;

  const remaining: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!(key in sent) || !Object.is(sent[key], value)) remaining[key] = value;
  }
  if (Object.keys(remaining).length === Object.keys(current).length) {
    return dirtyRows;
  }

  const next = new Map(dirtyRows);
  if (Object.keys(remaining).length > 0) next.set(rowId, remaining);
  else next.delete(rowId);
  return next;
}

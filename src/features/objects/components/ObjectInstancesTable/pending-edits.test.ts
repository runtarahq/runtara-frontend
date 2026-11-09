import { describe, expect, it } from 'vitest';

import {
  dropEditsForRows,
  recordCellEdit,
  restoreEditsForRows,
  settleSavedRow,
  type PendingEditState,
} from './pending-edits';

const ROW_A = '3f8a2c1d-9b4e-4f6a-8c2d-1e5b7a9c3d0f';
const ROW_B = '7c2e5b8a-1d4f-4a9c-b6e3-0f8d2a5c7e1b';

function state(overrides: Partial<PendingEditState> = {}): PendingEditState {
  return {
    dirtyRows: new Map([
      [ROW_A, { name: 'edited' }],
      [ROW_B, { qty: 3 }],
    ]),
    lastFocusedRowId: ROW_A,
    editingCellId: `${ROW_A}-name`,
    ...overrides,
  };
}

describe('dropEditsForRows', () => {
  it('drops dirty entries only for the deleted rows', () => {
    const result = dropEditsForRows(state(), [ROW_A]);

    expect(result.dirtyRows.has(ROW_A)).toBe(false);
    expect(result.dirtyRows.get(ROW_B)).toEqual({ qty: 3 });
  });

  it('does not mutate the input map', () => {
    const input = state();
    dropEditsForRows(input, [ROW_A]);

    expect(input.dirtyRows.has(ROW_A)).toBe(true);
  });

  it('clears the focused row only when it was deleted', () => {
    expect(dropEditsForRows(state(), [ROW_A]).lastFocusedRowId).toBeNull();
    expect(dropEditsForRows(state(), [ROW_B]).lastFocusedRowId).toBe(ROW_A);
  });

  it('clears the editing cell only when its row was deleted', () => {
    // A cell id is `${rowId}-${columnName}`; the row id itself contains
    // dashes, so this pins the prefix match to the full row id.
    expect(dropEditsForRows(state(), [ROW_A]).editingCellId).toBeNull();
    expect(dropEditsForRows(state(), [ROW_B]).editingCellId).toBe(
      `${ROW_A}-name`
    );
  });

  it('handles several deleted rows at once', () => {
    const result = dropEditsForRows(state(), [ROW_A, ROW_B]);

    expect(result.dirtyRows.size).toBe(0);
    expect(result.lastFocusedRowId).toBeNull();
    expect(result.editingCellId).toBeNull();
  });

  it('leaves empty state untouched', () => {
    const result = dropEditsForRows(
      { dirtyRows: new Map(), lastFocusedRowId: null, editingCellId: null },
      [ROW_A]
    );

    expect(result.dirtyRows.size).toBe(0);
    expect(result.lastFocusedRowId).toBeNull();
    expect(result.editingCellId).toBeNull();
  });
});

describe('recordCellEdit', () => {
  const SERVER = { name: 'old', qty: 1 };

  it('records a value that differs from the server', () => {
    const result = recordCellEdit(new Map(), ROW_A, { name: 'new' }, SERVER);

    expect(result.get(ROW_A)).toEqual({ name: 'new' });
  });

  it('leaves nothing to flush when an edit is reverted', () => {
    const dirty = recordCellEdit(new Map(), ROW_A, { name: 'new' }, SERVER);

    const reverted = recordCellEdit(dirty, ROW_A, { name: 'old' }, SERVER);

    expect(reverted.has(ROW_A)).toBe(false);
  });

  it('keeps the row other edits still need', () => {
    const dirty = new Map([[ROW_A, { name: 'new', qty: 2 }]]);

    const reverted = recordCellEdit(dirty, ROW_A, { name: 'old' }, SERVER);

    expect(reverted.get(ROW_A)).toEqual({ qty: 2 });
  });

  it('returns the same map when nothing changed', () => {
    const dirty = new Map([[ROW_A, { name: 'new' }]]);

    expect(recordCellEdit(dirty, ROW_A, { name: 'new' }, SERVER)).toBe(dirty);
    expect(recordCellEdit(dirty, ROW_B, { qty: 1 }, SERVER)).toBe(dirty);
  });

  it('counts every value on a draft, which has no server copy', () => {
    const result = recordCellEdit(new Map(), ROW_A, { name: '' });

    expect(result.get(ROW_A)).toEqual({ name: '' });
  });

  it('does not mutate the input map', () => {
    const dirty = new Map([[ROW_A, { name: 'new' }]]);

    recordCellEdit(dirty, ROW_A, { name: 'old' }, SERVER);

    expect(dirty.get(ROW_A)).toEqual({ name: 'new' });
  });
});

describe('settleSavedRow (OB-2)', () => {
  const rows = (entries: [string, Record<string, unknown>][]) =>
    new Map(entries);

  it('clears the row when nothing was typed during the save', () => {
    const sent = { name: 'A' };
    const next = settleSavedRow(rows([['r1', sent]]), 'r1', sent);
    expect(next.has('r1')).toBe(false);
  });

  it('keeps a value typed during the save', () => {
    const next = settleSavedRow(rows([['r1', { name: 'AB' }]]), 'r1', {
      name: 'A',
    });
    expect(next.get('r1')).toEqual({ name: 'AB' });
  });

  it('keeps a column first edited during the save, drops the sent one', () => {
    const next = settleSavedRow(
      rows([['r1', { name: 'A', city: 'Kyiv' }]]),
      'r1',
      { name: 'A' }
    );
    expect(next.get('r1')).toEqual({ city: 'Kyiv' });
  });

  it('leaves other rows alone', () => {
    const next = settleSavedRow(
      rows([
        ['r1', { name: 'A' }],
        ['r2', { name: 'B' }],
      ]),
      'r1',
      { name: 'A' }
    );
    expect(next.get('r2')).toEqual({ name: 'B' });
  });

  it('returns the same map when there is nothing to settle', () => {
    const map = rows([['r1', { name: 'AB' }]]);
    expect(settleSavedRow(map, 'r1', { name: 'A' })).toBe(map);
    expect(settleSavedRow(map, 'gone', { name: 'A' })).toBe(map);
  });
});

describe('restoreEditsForRows (OB-5)', () => {
  const before = {
    dirtyRows: new Map([
      [ROW_A, { name: 'unsaved' }],
      [ROW_B, { name: 'kept' }],
    ]),
    lastFocusedRowId: ROW_A,
  };

  it('puts back what a failed delete dropped', () => {
    const dropped = dropEditsForRows({ ...before, editingCellId: null }, [
      ROW_A,
    ]);
    const restored = restoreEditsForRows(dropped, before, [ROW_A]);
    expect(restored.dirtyRows.get(ROW_A)).toEqual({ name: 'unsaved' });
    expect(restored.dirtyRows.get(ROW_B)).toEqual({ name: 'kept' });
    expect(restored.lastFocusedRowId).toBe(ROW_A);
  });

  it('keeps an edit made after the drop over the dropped one', () => {
    const current = {
      dirtyRows: new Map([[ROW_A, { name: 'newer' }]]),
      lastFocusedRowId: ROW_B,
    };
    const restored = restoreEditsForRows(current, before, [ROW_A]);
    expect(restored.dirtyRows.get(ROW_A)).toEqual({ name: 'newer' });
    expect(restored.lastFocusedRowId).toBe(ROW_B);
  });

  it('returns the same map when there is nothing to restore', () => {
    const current = { dirtyRows: new Map(), lastFocusedRowId: null };
    const restored = restoreEditsForRows(
      current,
      { dirtyRows: new Map(), lastFocusedRowId: null },
      [ROW_A]
    );
    expect(restored.dirtyRows).toBe(current.dirtyRows);
    expect(restored.lastFocusedRowId).toBeNull();
  });
});

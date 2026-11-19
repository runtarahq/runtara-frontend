import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Condition, Instance } from '@/generated/RuntaraRuntimeApi';
import { isDraftRow } from './draft-row';
import { filterSchemaDefinition } from './filter-schema';
import { useBulkActions } from './use-bulk-actions';
import { useRecordsView } from './use-records-view';
import { useRowEdits } from './use-row-edits';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  bulkDelete: vi.fn(),
  bulkUpdate: vi.fn(),
  bulkCreate: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/features/objects/hooks/useObjectRecords.ts', () => ({
  useCreateObjectInstanceDto: () => ({ mutateAsync: mocks.create }),
  useUpdateObjectInstanceDto: () => ({ mutateAsync: mocks.update }),
  useBulkDeleteObjectInstances: () => ({ mutateAsync: mocks.bulkDelete }),
  useBulkUpdateObjectInstances: () => ({
    mutateAsync: mocks.bulkUpdate,
    isPending: false,
  }),
  useBulkCreateObjectInstances: () => ({
    mutateAsync: mocks.bulkCreate,
    isPending: false,
  }),
}));

const server = [
  { id: 'r1', properties: { title: 'One' } },
  { id: 'r2', properties: { title: 'Two' } },
] as unknown as Instance[];

const titles = (records: Instance[]) =>
  records.map((record) => record.properties?.title);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.create.mockResolvedValue({ id: 'r9' });
  mocks.bulkDelete.mockResolvedValue({});
  mocks.bulkUpdate.mockResolvedValue(2);
});

describe('useRecordsView', () => {
  it('returns to the first page when the filter, the sort or the page size changes', () => {
    const { result } = renderHook(() => useRecordsView());

    act(() => result.current.changePage(3));
    act(() => result.current.changeFilter({ op: 'EQ' } as Condition));
    expect(result.current.page).toBe(0);

    act(() => result.current.changePage(3));
    act(() => result.current.changeSorting([{ id: 'title', desc: true }]));
    expect(result.current.page).toBe(0);

    act(() => result.current.changePage(3));
    act(() => result.current.changePageSize(50));
    expect(result.current.page).toBe(0);
    expect(result.current.pageSize).toBe(50);
  });

  it('sends a sort as the API names it, system columns without their underscore', () => {
    const { result } = renderHook(() => useRecordsView());
    expect(result.current.sortBy).toBeUndefined();

    act(() =>
      result.current.changeSorting(() => [
        { id: '_createdAt', desc: true },
        { id: 'title', desc: false },
      ])
    );

    expect(result.current.sortBy).toEqual(['createdAt', 'title']);
    expect(result.current.sortOrder).toEqual(['desc', 'asc']);
  });

  it('keeps a selection only while the rows it was made on are shown', () => {
    const { result } = renderHook(() => useRecordsView());

    act(() => result.current.setRowSelection({ r1: true, r2: false }));
    expect(result.current.selectedIds).toEqual(['r1']);

    act(() => result.current.changePage(1));
    expect(result.current.selectedIds).toEqual([]);
  });
});

describe('filterSchemaDefinition', () => {
  it('offers the system fields, then the type’s columns', () => {
    expect(
      filterSchemaDefinition([
        { name: 'title', type: 'string' },
        { name: 'count', type: 'integer' },
      ])
    ).toEqual({
      id: { name: 'ID', dataType: 'STRING' },
      createdAt: { name: 'Created At', dataType: 'DATE' },
      updatedAt: { name: 'Updated At', dataType: 'DATE' },
      title: { name: 'title', dataType: 'STRING' },
      count: { name: 'count', dataType: 'INTEGER' },
    });
    expect(Object.keys(filterSchemaDefinition(undefined))).toHaveLength(3);
  });
});

describe('useRowEdits', () => {
  const edits = () =>
    renderHook(() =>
      useRowEdits({ schemaId: 's1', connectionId: 'c1', serverRecords: server })
    );

  it('shows an edit at once and writes it when the user moves to another row', async () => {
    const { result } = edits();

    act(() => result.current.handleCellFocus('r1'));
    act(() =>
      result.current.handleUpdate('r1', { properties: { title: 'Edited' } })
    );
    expect(titles(result.current.records)).toEqual(['Edited', 'Two']);
    expect(mocks.update).not.toHaveBeenCalled();

    act(() => result.current.handleCellFocus('r2'));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        schemaId: 's1',
        instanceId: 'r1',
        data: { properties: { title: 'Edited' } },
      })
    );
  });

  it('marks a row the server refused, and does not send the same values again', async () => {
    mocks.update.mockRejectedValue(new Error('refused'));
    const { result } = edits();

    act(() =>
      result.current.handleUpdate('r1', { properties: { title: 'Bad' } })
    );
    act(() => result.current.handleCellFocus('r1'));
    act(() => result.current.handleCellFocus('r2'));

    await waitFor(() =>
      expect(result.current.failedRowIds.has('r1')).toBe(true)
    );
    expect(mocks.toast.error).toHaveBeenCalledWith('Failed to update record');

    act(() => result.current.handleCellFocus('r1'));
    act(() => result.current.handleCellFocus('r2'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('adds a draft row, and creates the record when the draft is committed', async () => {
    const { result } = edits();

    act(() => result.current.handleAddRow());
    expect(result.current.draftCount).toBe(1);
    const draftId = result.current.records[2].id!;
    expect(isDraftRow(draftId)).toBe(true);

    act(() =>
      result.current.handleUpdate(draftId, { properties: { title: 'New' } })
    );
    act(() => result.current.commitRow(draftId));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        schemaId: 's1',
        data: { properties: { title: 'New' }, schemaId: 's1' },
      })
    );
    await waitFor(() => expect(result.current.draftCount).toBe(0));
  });

  it('gives up the edits and drafts of rows being deleted, and can bring the edits back', () => {
    const { result } = edits();
    act(() => result.current.handleAddRow());
    const draftId = result.current.records[2].id!;
    act(() =>
      result.current.handleUpdate('r1', { properties: { title: 'Edited' } })
    );

    let discarded!: ReturnType<typeof result.current.discardRows>;
    act(() => {
      discarded = result.current.discardRows(['r1', draftId]);
    });

    expect(discarded.recordIds).toEqual(['r1']);
    expect(result.current.draftCount).toBe(0);
    expect(titles(result.current.records)).toEqual(['One', 'Two']);

    act(() => discarded.restore());
    expect(titles(result.current.records)).toEqual(['Edited', 'Two']);
  });
});

describe('useBulkActions', () => {
  const setup = (selectedIds: string[], recordIds: string[] = selectedIds) => {
    const restore = vi.fn();
    const clearSelection = vi.fn();
    const discardRows = vi.fn(() => ({ recordIds, restore }));
    const hook = renderHook(() =>
      useBulkActions({
        schemaId: 's1',
        connectionId: 'c1',
        selectedIds,
        clearSelection,
        discardRows,
      })
    );
    return { ...hook, restore, clearSelection, discardRows };
  };

  it('deletes the selected records and closes the dialog', async () => {
    const { result, clearSelection, discardRows } = setup(['r1', 'r2']);
    act(() => result.current.setDeleteOpen(true));

    await act(() => result.current.deleteSelected());

    expect(discardRows).toHaveBeenCalledWith(['r1', 'r2']);
    expect(mocks.bulkDelete).toHaveBeenCalledWith({
      schemaId: 's1',
      instanceIds: ['r1', 'r2'],
    });
    expect(clearSelection).toHaveBeenCalled();
    expect(result.current.deleteOpen).toBe(false);
  });

  it('asks the server nothing when only drafts were selected', async () => {
    const { result, clearSelection } = setup(['draft'], []);

    await act(() => result.current.deleteSelected());

    expect(mocks.bulkDelete).not.toHaveBeenCalled();
    expect(clearSelection).toHaveBeenCalled();
  });

  it('brings the edits back and keeps the dialog when the delete fails', async () => {
    mocks.bulkDelete.mockRejectedValue(new Error('locked'));
    const { result, restore, clearSelection } = setup(['r1']);
    act(() => result.current.setDeleteOpen(true));

    await act(() => result.current.deleteSelected());

    expect(restore).toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
    expect(result.current.deleteOpen).toBe(true);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Unable to delete selected records',
      { description: 'locked' }
    );
  });

  it('edits the selected records, and nothing when there is nothing to set', async () => {
    const { result, clearSelection } = setup(['r1', 'r2']);

    await act(() => result.current.editSelected({}));
    expect(mocks.bulkUpdate).not.toHaveBeenCalled();

    await act(() => result.current.editSelected({ title: 'Same' }));
    expect(mocks.bulkUpdate).toHaveBeenCalledWith({
      schemaId: 's1',
      instanceIds: ['r1', 'r2'],
      properties: { title: 'Same' },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Updated 2 records');
    expect(clearSelection).toHaveBeenCalled();
  });

  it('reports a batch insert that left some rows out', async () => {
    mocks.bulkCreate.mockResolvedValue({
      createdCount: 2,
      skippedCount: 1,
      errors: [{}],
    });
    const { result } = setup([]);

    await act(async () => {
      await result.current.insert([{}, {}, {}], 'skip', 'skip', []);
    });

    expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Inserted 2, skipped 1 (1 error)'
    );
  });
});

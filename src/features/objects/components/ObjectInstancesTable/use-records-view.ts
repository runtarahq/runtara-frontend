import { useCallback, useState } from 'react';
import type { RowSelectionState, SortingState } from '@tanstack/react-table';

import type { Condition } from '@/generated/RuntaraRuntimeApi';

/**
 * Which records the table shows: the filter, the page, the sort, and the
 * rows selected among those on screen.
 */
export function useRecordsView() {
  const [filterCondition, setFilterCondition] = useState<Condition | null>(
    null
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // A selection belongs to the rows on screen. It used to survive page, sort
  // and filter changes, so Delete removed rows the user could no longer see
  // (OB-11). Cleared in the render that sees the change.
  const viewKey = JSON.stringify([filterCondition, page, pageSize, sorting]);
  const [selectionView, setSelectionView] = useState(viewKey);
  if (selectionView !== viewKey) {
    setSelectionView(viewKey);
    if (Object.keys(rowSelection).length) setRowSelection({});
  }

  // Convert TanStack SortingState to API format
  // Strip leading underscore from system column IDs (_createdAt -> createdAt)
  const sortBy =
    sorting.length > 0
      ? sorting.map((s) => (s.id.startsWith('_') ? s.id.slice(1) : s.id))
      : undefined;
  const sortOrder =
    sorting.length > 0
      ? sorting.map((s) => (s.desc ? 'desc' : 'asc'))
      : undefined;

  const changeFilter = (condition: Condition | null) => {
    setFilterCondition(condition);
    setPage(0);
  };

  const changePageSize = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  const changeSorting = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const newSorting =
        typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newSorting);
      setPage(0); // Reset to first page when sorting changes
    },
    [sorting]
  );

  const selectedIds = Object.keys(rowSelection).filter(
    (key) => rowSelection[key]
  );
  const clearSelection = useCallback(() => setRowSelection({}), []);

  return {
    filterCondition,
    changeFilter,
    page,
    changePage: setPage,
    pageSize,
    changePageSize,
    sorting,
    changeSorting,
    sortBy,
    sortOrder,
    rowSelection,
    setRowSelection,
    selectedIds,
    clearSelection,
  };
}

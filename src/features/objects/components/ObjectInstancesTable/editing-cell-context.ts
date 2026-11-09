import { createContext, useCallback, useContext } from 'react';

interface EditingCellContextValue {
  editingCellId: string | null;
  setEditingCellId: (update: (current: string | null) => string | null) => void;
}

/**
 * Which grid cell is in edit mode, as `${rowId}-${columnName}`.
 *
 * It lives in context rather than in the column definitions because TanStack
 * renders a column's `cell` function as a component: changing the definitions
 * remounts every cell, and that throws away the state Escape reverts to.
 */
export const EditingCellContext = createContext<EditingCellContextValue>({
  editingCellId: null,
  setEditingCellId: () => {},
});

export function useCellEditing(cellId: string) {
  const { editingCellId, setEditingCellId } = useContext(EditingCellContext);
  const setIsEditing = useCallback(
    (editing: boolean) =>
      // Closing only ever closes this cell: its blur can arrive after a click
      // has already opened another one.
      setEditingCellId((current) =>
        editing ? cellId : current === cellId ? null : current
      ),
    [cellId, setEditingCellId]
  );
  return { isEditing: editingCellId === cellId, setIsEditing };
}

import { EditableCell } from './EditableCell';
import { useCellEditing } from './editing-cell-context';

type GridCellProps = Omit<
  React.ComponentProps<typeof EditableCell>,
  'isEditing' | 'setIsEditing'
>;

/** An editable grid cell that reads its edit state from the grid. */
export function GridCell(props: GridCellProps) {
  const editing = useCellEditing(`${props.row.original.id}-${props.column.id}`);
  return <EditableCell {...props} {...editing} />;
}

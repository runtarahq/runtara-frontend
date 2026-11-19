import type { StateField } from '@/features/runs/components/StateValue';
export function stateLabel(key: string, field?: StateField) {
  return (
    field?.label ??
    key.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

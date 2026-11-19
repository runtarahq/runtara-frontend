import { Redo2, Undo2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';

/** Undo and redo of canvas edits; the editor binds the same to the keyboard. */
export function UndoRedoButtons({ disabled }: { disabled: boolean }) {
  const canUndo = useWorkflowStore((state) => state.past.length > 0);
  const canRedo = useWorkflowStore((state) => state.future.length > 0);
  const undo = useWorkflowStore((state) => state.undo);
  const redo = useWorkflowStore((state) => state.redo);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="rounded hover:bg-muted"
        disabled={disabled || !canUndo}
        onClick={undo}
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="rounded hover:bg-muted"
        disabled={disabled || !canRedo}
        onClick={redo}
        title="Redo"
        aria-label="Redo"
      >
        <Redo2 className="size-4" />
      </Button>
    </>
  );
}

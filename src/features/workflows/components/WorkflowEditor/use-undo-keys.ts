import { useEffect } from 'react';

import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';

/** Which of undo and redo a key press asks for, if either. */
export function undoKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.shiftKey) return 'redo';
  return null;
}

/**
 * Whether the press belongs to something that has an undo of its own (a
 * field being typed in) or to a dialog over the canvas, whose edits are not
 * the canvas's until it is applied.
 */
function belongsElsewhere(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
    return true;
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    Boolean(target.closest('[role="textbox"], [role="combobox"]'))
  );
}

/** Binds undo and redo of canvas edits to the keyboard while the editor is open. */
export function useUndoKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = undoKey(event);
      if (!action || belongsElsewhere(event.target)) return;
      event.preventDefault();
      useWorkflowStore.getState()[action]();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}

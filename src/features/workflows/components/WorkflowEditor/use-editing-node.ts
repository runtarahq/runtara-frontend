import { useCallback, useRef, useState } from 'react';

/**
 * Which step the config panel is editing.
 *
 * Moving the open panel to another step must not silently drop unsaved edits
 * on this one. While the panel is dirty, `editNode` parks the requested step
 * in `switchTargetId` for a discard prompt, and only `confirmSwitch` moves on.
 */
export function useEditingNode() {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);
  const editingNodeIdRef = useRef(editingNodeId);
  editingNodeIdRef.current = editingNodeId;
  const dirtyRef = useRef(false);

  /** Report from the panel whether it holds unsaved edits. */
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  /** Opens `nodeId`; false when that waits on the discard prompt. */
  const editNode = useCallback((nodeId: string) => {
    const current = editingNodeIdRef.current;
    if (current && current !== nodeId && dirtyRef.current) {
      setSwitchTargetId(nodeId);
      return false;
    }
    setEditingNodeId(nodeId);
    return true;
  }, []);

  const closeEditor = useCallback(() => {
    dirtyRef.current = false;
    setEditingNodeId(null);
  }, []);

  /** Discard this step's edits and open the step that was waiting. */
  const confirmSwitch = useCallback(() => {
    if (switchTargetId) {
      dirtyRef.current = false;
      setEditingNodeId(switchTargetId);
    }
    setSwitchTargetId(null);
  }, [switchTargetId]);

  const cancelSwitch = useCallback(() => setSwitchTargetId(null), []);

  return {
    editingNodeId,
    /** Unguarded: for following a rename of the step being edited. */
    setEditingNodeId,
    editNode,
    closeEditor,
    setDirty,
    switchTargetId,
    confirmSwitch,
    cancelSwitch,
  };
}

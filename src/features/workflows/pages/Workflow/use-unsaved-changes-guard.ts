import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useNavigationBlockerStore } from '@/shared/stores/navigationBlockerStore';
import type { WorkflowChanges } from './workflow-settings';

/**
 * What the workflow page knows about unsaved work, and what it does before
 * throwing it away.
 *
 * Unsaved is an edited canvas or a staged setting. While a version is being
 * switched to there is none: what was there was discarded on purpose, and
 * saying otherwise made the buttons flicker. An action that would discard
 * unsaved work (switching version, importing) is held behind a dialog, and
 * leaving the page is held by the app's navigation blocker, and reloading or
 * closing it by the browser's own question.
 */
import { useWarnBeforeUnload } from '@/shared/hooks/useWarnBeforeUnload';
export function useUnsavedChangesGuard({
  isSwitchingVersion,
  stagedWorkflowChanges,
  discardStagedChanges,
}: {
  isSwitchingVersion: boolean;
  stagedWorkflowChanges: WorkflowChanges;
  /** Drops every staged setting. Stable across renders. */
  discardStagedChanges: () => void;
}) {
  const [isUnsavedChangesDialogOpen, setIsUnsavedChangesDialogOpen] =
    useState(false);
  const pendingUnsavedChangesActionRef = useRef<(() => void) | null>(null);

  // Reactively subscribe to isDirty state
  const isDirty = useWorkflowStore((state) => state.isDirty);
  const isStructurallyDirty = useWorkflowStore(
    (state) => state.isStructurallyDirty
  );

  // Compute if there are any unsaved changes (workflow dirty or staged node/workflow changes)
  // Ignore dirty state during version switching to prevent button flickering
  const hasUnsavedChanges = useMemo(() => {
    // During version switch, we don't have unsaved changes (they were intentionally discarded)
    if (isSwitchingVersion) {
      return false;
    }
    const hasWorkflowChanges = Object.keys(stagedWorkflowChanges).length > 0;
    return isDirty || hasWorkflowChanges;
  }, [isDirty, stagedWorkflowChanges, isSwitchingVersion]);

  // Structural changes (add/remove/edit nodes or edges) block execution.
  // Position-only changes (dragging, auto-layout) do not.
  const hasStructuralUnsavedChanges = useMemo(() => {
    if (isSwitchingVersion) {
      return false;
    }
    return isStructurallyDirty || Object.keys(stagedWorkflowChanges).length > 0;
  }, [isStructurallyDirty, stagedWorkflowChanges, isSwitchingVersion]);

  // A reload or a closed tab asks first, as leaving within the app does.
  useWarnBeforeUnload(hasUnsavedChanges);

  // Helper to check for unsaved changes before performing a destructive action (version change, import)
  const confirmIfUnsavedChanges = useCallback(
    (action: () => void) => {
      if (hasUnsavedChanges) {
        pendingUnsavedChangesActionRef.current = action;
        setIsUnsavedChangesDialogOpen(true);
      } else {
        action();
      }
    },
    [hasUnsavedChanges]
  );

  const handleConfirmUnsavedChanges = useCallback(() => {
    const pendingAction = pendingUnsavedChangesActionRef.current;
    pendingUnsavedChangesActionRef.current = null;
    setIsUnsavedChangesDialogOpen(false);

    if (pendingAction) {
      pendingAction();
    }
  }, []);

  const handleCancelUnsavedChanges = useCallback(() => {
    pendingUnsavedChangesActionRef.current = null;
    setIsUnsavedChangesDialogOpen(false);
  }, []);

  // Use the global navigation blocker store
  const setBlocker = useNavigationBlockerStore((state) => state.setBlocker);

  // Register/unregister the blocker based on hasUnsavedChanges
  useEffect(() => {
    setBlocker(hasUnsavedChanges, () => {
      discardStagedChanges();
      useWorkflowStore.getState().clearDirtyFlag();
    });

    return () => {
      setBlocker(false);
    };
  }, [hasUnsavedChanges, setBlocker, discardStagedChanges]);

  return {
    hasUnsavedChanges,
    hasStructuralUnsavedChanges,
    confirmIfUnsavedChanges,
    isUnsavedChangesDialogOpen,
    handleConfirmUnsavedChanges,
    handleCancelUnsavedChanges,
  };
}

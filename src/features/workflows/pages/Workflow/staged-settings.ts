import { createStore } from 'zustand';

import { editorStore } from '@/features/workflows/stores/editor-scope';
import { dropSavedEntries } from './drop-saved-entries';
import type { WorkflowChanges } from './workflow-settings';

interface StagedSettingsState {
  /** The settings changed and not yet saved; empty when there are none. */
  staged: WorkflowChanges;
  /** Stages changes over the ones already staged. */
  stage: (changes: WorkflowChanges) => void;
  /** Makes these the staged settings, as an import does. */
  replace: (settings: WorkflowChanges) => void;
  /** Drops every staged setting. */
  discard: () => void;
  /**
   * After a save that sent `sent`: drops what it saved. A setting edited
   * while the save was in flight was not sent, and stays staged (WF-2).
   */
  settle: (sent: WorkflowChanges) => void;
}

/**
 * The workflow's settings (name, description, variables, schemas, timeouts)
 * the user changed and has not saved. With the rest of the editor's state: one
 * per open workflow, gone when it closes.
 */
export const useStagedSettings = editorStore('stagedSettings', () =>
  createStore<StagedSettingsState>()((set) => ({
    staged: {},
    stage: (changes) =>
      set((state) => ({ staged: { ...state.staged, ...changes } })),
    replace: (settings) => set({ staged: settings }),
    discard: () =>
      set((state) =>
        Object.keys(state.staged).length === 0 ? state : { staged: {} }
      ),
    settle: (sent) =>
      set((state) => ({ staged: dropSavedEntries(state.staged, sent) })),
  }))
);

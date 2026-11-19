import { useMemo } from 'react';
import { NODE_TYPES } from '@/features/workflows/config/workflow';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import {
  mergeWorkflowSettings,
  type WorkflowChanges,
} from './workflow-settings';

export type { WorkflowChanges, WorkflowVariable } from './workflow-settings';

type WorkflowSettingsData = WorkflowChanges;

/** Merge staged settings without losing explicit resets, nulls, or false values. */
export function useWorkflowSettings(
  workflowId: string | undefined,
  data: WorkflowSettingsData,
  stagedWorkflowChanges: WorkflowChanges
) {
  const currentEditorNodes = useWorkflowStore((state) => state.nodes);
  const entryPointOptions = useMemo(() => {
    return currentEditorNodes
      .filter(
        (node) =>
          node.type !== NODE_TYPES.NoteNode &&
          node.type !== NODE_TYPES.CreateNode &&
          node.type !== NODE_TYPES.StartIndicatorNode &&
          !node.parentId
      )
      .map((node) => ({
        id: node.id,
        name: String(node.data?.name || node.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentEditorNodes]);

  // Memoize workflow object to prevent unnecessary re-renders in WorkflowPropertiesDialog
  return useMemo(
    () => ({
      id: workflowId || '',
      ...mergeWorkflowSettings(data, stagedWorkflowChanges),
      entryPointOptions,
    }),
    [workflowId, stagedWorkflowChanges, data, entryPointOptions]
  );
}

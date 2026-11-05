import { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import { NODE_TYPES } from '@/features/workflows/config/workflow';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import type { WorkflowData } from '@/features/workflows/components/WorkflowEditor/EditorSidebar';
import type { UIVariable } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/VariablesEditor';

export type WorkflowVariable = UIVariable;

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export type WorkflowChanges = Partial<
  Omit<WorkflowData, 'id' | 'entryPointOptions'>
>;

type WorkflowSettingsData = WorkflowChanges & { nodes?: Node[] };

/** Merge staged settings without losing explicit resets, nulls, or false values. */
export function useWorkflowSettings(
  workflowId: string | undefined,
  data: WorkflowSettingsData,
  stagedWorkflowChanges: WorkflowChanges
) {
  const currentEditorNodes = useWorkflowStore((state) => state.nodes);
  const entryPointOptions = useMemo(() => {
    const nodesForOptions =
      currentEditorNodes.length > 0 ? currentEditorNodes : data.nodes || [];
    return nodesForOptions
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
  }, [currentEditorNodes, data.nodes]);

  // Memoize workflow object to prevent unnecessary re-renders in WorkflowPropertiesDialog
  return useMemo(
    () => ({
      id: workflowId || '',
      name: stagedWorkflowChanges.name ?? data.name ?? '',
      description: stagedWorkflowChanges.description ?? data.description ?? '',
      variables: stagedWorkflowChanges.variables ?? data.variables ?? [],
      inputSchemaFields:
        stagedWorkflowChanges.inputSchemaFields ?? data.inputSchemaFields ?? [],
      outputSchemaFields:
        stagedWorkflowChanges.outputSchemaFields ??
        data.outputSchemaFields ??
        [],
      stateSchemaFields:
        stagedWorkflowChanges.stateSchemaFields ?? data.stateSchemaFields ?? [],
      executionTimeoutSeconds:
        stagedWorkflowChanges.executionTimeoutSeconds ??
        data.executionTimeoutSeconds,
      rateLimitBudgetMs:
        stagedWorkflowChanges.rateLimitBudgetMs ?? data.rateLimitBudgetMs,
      durable: hasOwn(stagedWorkflowChanges, 'durable')
        ? stagedWorkflowChanges.durable
        : data.durable,
      entryPoint: hasOwn(stagedWorkflowChanges, 'entryPoint')
        ? stagedWorkflowChanges.entryPoint
        : data.entryPoint,
      entryPointOptions,
      memoryMb: hasOwn(stagedWorkflowChanges, 'memoryMb')
        ? stagedWorkflowChanges.memoryMb
        : data.memoryMb,
      trackEvents: hasOwn(stagedWorkflowChanges, 'trackEvents')
        ? stagedWorkflowChanges.trackEvents
        : data.trackEvents,
    }),
    [workflowId, stagedWorkflowChanges, data, entryPointOptions]
  );
}

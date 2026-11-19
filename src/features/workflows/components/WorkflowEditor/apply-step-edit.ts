import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useValidationStore } from '@/features/workflows/stores/validationStore';
import { StepNodeData } from '@/features/workflows/types/execution-graph';
import { canvasNodeStepId } from '@/features/workflows/utils/execution-graph/canvas-ids';
import { withMemoryConversation } from './NodeForm/memory-conversation';

/**
 * What the node form submits, apart from the step's data: a staged rename of
 * the step's id, and two fields that exist only for the form (the on-wait
 * JSON error that blocks Save, the choice to add an on-wait flow).
 */
type SubmittedStep = Record<string, unknown> & {
  renameStepTo?: string;
  inputMapping?: unknown;
};

/** The step's data out of a submitted form, and the id it asks for. */
export function stepEditOf<T extends SubmittedStep>(submitted: T) {
  const { renameStepTo, ...data } = submitted;
  delete (data as { onWaitJsonError?: unknown }).onWaitJsonError;
  delete (data as { addOnWaitFlow?: unknown }).addOnWaitFlow;
  return { data: data as Omit<T, 'renameStepTo'>, renameStepTo };
}

/**
 * Writes a validated edit of an existing step to the workflow: the rename it
 * staged, then its data, then what follows from the data (an AI Agent's
 * conversation id reaches its memory provider on Save only, ED-33).
 *
 * The rename goes first and may be refused (an id in use, a malformed one);
 * nothing is written then, and the refusal is returned for the user.
 */
export function applyStepEdit(
  nodeId: string,
  data: Record<string, unknown> & { inputMapping?: unknown },
  renameStepTo: string | undefined
): { savedId: string } | { error: string } {
  let savedId = nodeId;
  if (renameStepTo && renameStepTo !== canvasNodeStepId(nodeId)) {
    const renameError = useWorkflowStore
      .getState()
      .renameStep(nodeId, renameStepTo);
    if (renameError) return { error: renameError };
    savedId = useWorkflowStore.getState().lastStepRename?.newId ?? renameStepTo;
    // The problems that named the step follow it to its new id.
    useValidationStore.getState().renameStep(nodeId, savedId);
  }
  useWorkflowStore.getState().updateNode(savedId, data as StepNodeData);
  const synced = withMemoryConversation(
    useWorkflowStore.getState().nodes,
    data.inputMapping as Parameters<typeof withMemoryConversation>[1]
  );
  if (synced) {
    useWorkflowStore.getState().editNodes(() => synced);
  }
  return { savedId };
}

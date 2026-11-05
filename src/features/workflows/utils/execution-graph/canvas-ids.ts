import type {
  ExecutionGraphDto,
  ExecutionGraphStepDto,
} from '@/features/workflows/types/execution-graph';

/**
 * Step ids are unique per graph, but React Flow node ids are global: two
 * Splits may each hold an `iter_finish`, and a subgraph may reuse its
 * parent's `finish`. On load, the shallowest step keeps its plain id as the
 * node id; a later step with a taken id gets `<container node id>/<step id>`.
 * `/` never appears in a step id, so a qualified node id cannot collide with
 * a plain one, and its last segment is always the real step id.
 */
const CANVAS_SCOPE_SEPARATOR = '/';

/** The DSL step id a canvas node id stands for. */
export function canvasNodeStepId(nodeId: string): string {
  return nodeId.slice(nodeId.lastIndexOf(CANVAS_SCOPE_SEPARATOR) + 1);
}

export function canvasScopeKey(
  parentNodeId: string | undefined,
  stepId: string
) {
  return `${parentNodeId ?? ''}\u0000${stepId}`;
}

/**
 * A WaitForSignal's `onWait` graph, when it is non-empty and so renders as a
 * container. Empty or malformed onWait graphs stay in node data.
 */
export function canvasOnWaitGraph(
  step: ExecutionGraphStepDto
): (ExecutionGraphDto & Record<string, unknown>) | undefined {
  if ((step.stepType as string) !== 'WaitForSignal') {
    return undefined;
  }
  const rawOnWait = (step as Record<string, unknown>).onWait as
    (ExecutionGraphDto & Record<string, unknown>) | undefined;
  if (
    rawOnWait &&
    typeof rawOnWait === 'object' &&
    !Array.isArray(rawOnWait) &&
    rawOnWait.steps &&
    typeof rawOnWait.steps === 'object' &&
    Object.keys(rawOnWait.steps).length > 0
  ) {
    return rawOnWait;
  }
  return undefined;
}

/**
 * Assign a unique canvas node id to every step, keyed by
 * `canvasScopeKey(container node id, step id)`. Breadth-first, so a root
 * step always keeps its plain id over a nested step with the same id.
 */
export function assignCanvasNodeIds(
  steps: Record<string, ExecutionGraphStepDto>
): Map<string, string> {
  const nodeIds = new Map<string, string>();
  const taken = new Set<string>();
  let level: Array<{
    steps: Record<string, ExecutionGraphStepDto>;
    parentNodeId?: string;
  }> = [{ steps }];

  while (level.length > 0) {
    const nextLevel: typeof level = [];
    for (const { steps: graphSteps, parentNodeId } of level) {
      for (const [stepId, step] of Object.entries(graphSteps)) {
        let nodeId = stepId;
        for (let counter = 1; taken.has(nodeId); counter += 1) {
          const scope =
            counter === 1
              ? (parentNodeId ?? '')
              : `${parentNodeId ?? ''}${CANVAS_SCOPE_SEPARATOR}${counter}`;
          nodeId = `${scope}${CANVAS_SCOPE_SEPARATOR}${stepId}`;
        }
        taken.add(nodeId);
        nodeIds.set(canvasScopeKey(parentNodeId, stepId), nodeId);

        const nested = step.subgraph ?? canvasOnWaitGraph(step);
        if (nested?.steps) {
          nextLevel.push({ steps: nested.steps, parentNodeId: nodeId });
        }
      }
    }
    level = nextLevel;
  }

  return nodeIds;
}

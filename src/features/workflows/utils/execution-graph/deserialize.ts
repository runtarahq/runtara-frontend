import type { Node } from '@xyflow/react';
import type { ExecutionGraphDto } from '@/features/workflows/types/execution-graph';
import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
} from '@/features/workflows/config/workflow';
import {
  snapToGrid,
  snapPositionToGrid,
} from '@/features/workflows/config/workflow-editor';
import type { Note } from '@/generated/RuntaraRuntimeApi';
import {
  migrateStartStep,
  needsStartStepMigration,
} from '@/features/workflows/utils/start-step-migration';
import { ensureContainersContainChildren } from '@/features/workflows/components/WorkflowEditor/CustomNodes/layout';
import { assignCanvasNodeIds } from './canvas-ids';
import { applyStoredNodeVisualState } from './visual-state';
import { normalizeNodesAndEdges } from './deserialize-steps';

export function executionGraphToReactFlow(
  executionGraph: ExecutionGraphDto & { notes?: Note[]; nodes?: unknown }
) {
  // Migrate legacy Start steps if present
  let graphToProcess = executionGraph;
  if (needsStartStepMigration(executionGraph)) {
    const migrationResult = migrateStartStep(executionGraph);
    graphToProcess = migrationResult.executionGraph as ExecutionGraphDto & {
      notes?: Note[];
    };

    // Log migration for debugging
    if (migrationResult.wasMigrated) {
      console.info(
        'Migrated legacy Start step from execution graph.',
        migrationResult.extractedInputSchema ? 'Extracted inputSchema.' : '',
        migrationResult.extractedVariables ? 'Extracted variables.' : ''
      );
    }
  }

  const { steps = {}, executionPlan = [], notes = [] } = graphToProcess;
  const { nodes: parsedNodes, edges } = normalizeNodesAndEdges(
    steps,
    executionPlan || [],
    assignCanvasNodeIds(steps)
  );
  // Stored visual state may predate a node's containerization (e.g. a
  // WaitForSignal whose onWait was authored as JSON while it was a basic
  // node), so re-clamp container sizes to their children afterwards.
  const nodes = ensureContainersContainChildren(
    applyStoredNodeVisualState(parsedNodes, graphToProcess.nodes)
  );

  // Convert notes to React Flow nodes
  // New format uses: { text, position: {x, y} }
  const noteNodes: Node[] = (notes || []).map((note: any) => {
    const defaultSize = NODE_TYPE_SIZES[NODE_TYPES.NoteNode] || {
      width: 240,
      height: 120,
    };
    const width = snapToGrid(note.metadata?.width ?? defaultSize.width);
    const height = snapToGrid(note.metadata?.height ?? defaultSize.height);

    // Handle position - new format uses position.x/y
    const x = note.position?.x ?? note.x ?? 0;
    const y = note.position?.y ?? note.y ?? 0;

    // Handle content - new format uses "text" field
    const content = note.text ?? note.content ?? '';

    return {
      id: note.id,
      type: NODE_TYPES.NoteNode,
      position: snapPositionToGrid({ x, y }),
      data: {
        id: note.id,
        content,
        ...(typeof note.metadata?.anchorStepId === 'string' &&
        note.metadata.anchorStepId
          ? { anchorStepId: note.metadata.anchorStepId }
          : {}),
      },
      width,
      height,
      style: {
        width,
        height,
      },
    };
  });

  return { nodes: [...nodes, ...noteNodes], edges };
}

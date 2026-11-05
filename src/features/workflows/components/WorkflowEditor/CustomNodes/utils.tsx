import type { Node, Edge } from '@xyflow/react';
import { snapToGrid } from '@/features/workflows/config/workflow-editor';
import { layoutReactFlowElements } from './layout';
import type { CanvasDetailLevel } from './node-size';

export { BASE_GROUP_WIDTH, BASE_WIDTH } from './layout';
export { composeExecutionGraph } from '@/features/workflows/utils/execution-graph/serialize';
export { executionGraphToReactFlow } from '@/features/workflows/utils/execution-graph/deserialize';
export { canvasNodeStepId } from '@/features/workflows/utils/execution-graph/canvas-ids';
export type {
  ExecutionGraph,
  ExecutionGraphStep,
  ExecutionGraphTransition,
} from '@/features/workflows/utils/execution-graph/types';

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options?: { detailLevel?: CanvasDetailLevel }
) {
  return layoutReactFlowElements(nodes, edges, options);
}

export const getNodePositionInsideParent = (
  node: Partial<Node>,
  groupNode: Node
) => {
  const position = node.position ?? { x: 0, y: 0 };
  const nodeWidth = node.measured?.width ?? 0;
  const nodeHeight = node.measured?.height ?? 0;
  const groupWidth = groupNode.measured?.width ?? 0;
  const groupHeight = groupNode.measured?.height ?? 0;

  if (position.x < groupNode.position.x) {
    position.x = 0;
  } else if (position.x + nodeWidth > groupNode.position.x + groupWidth) {
    position.x = snapToGrid(groupWidth - nodeWidth);
  } else {
    position.x = snapToGrid(position.x - groupNode.position.x);
  }

  if (position.y < groupNode.position.y) {
    position.y = 0;
  } else if (position.y + nodeHeight > groupNode.position.y + groupHeight) {
    position.y = snapToGrid(groupHeight - nodeHeight);
  } else {
    position.y = snapToGrid(position.y - groupNode.position.y);
  }

  return position;
};

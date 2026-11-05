import type { Node } from '@xyflow/react';
import {
  snapToGrid,
  snapPositionToGrid,
} from '@/features/workflows/config/workflow-editor';
import { isResizableNodeType } from '@/features/workflows/components/WorkflowEditor/CustomNodes/node-size';

export function applyStoredNodeVisualState(
  nodes: Node[],
  storedNodes: unknown
) {
  if (!Array.isArray(storedNodes)) {
    return nodes;
  }

  const visualStateById = new Map<string, any>();
  for (const storedNode of storedNodes) {
    if (
      storedNode &&
      typeof storedNode === 'object' &&
      typeof storedNode.id === 'string'
    ) {
      visualStateById.set(storedNode.id, storedNode);
    }
  }

  if (visualStateById.size === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const visualState = visualStateById.get(node.id);
    if (!visualState) {
      return node;
    }

    const position =
      visualState.position &&
      typeof visualState.position.x === 'number' &&
      typeof visualState.position.y === 'number'
        ? snapPositionToGrid({
            x: visualState.position.x,
            y: visualState.position.y,
          })
        : node.position;
    // Only resizable nodes keep a saved size. Every other card renders at a
    // size fixed by its type, and an old saved size (say 132x36 from before
    // the card redesign) would make the layout pack cards into boxes smaller
    // than they draw, so they overlap and edges run underneath them.
    const resizable = isResizableNodeType(node.type);
    const width =
      resizable && typeof visualState.width === 'number'
        ? snapToGrid(visualState.width)
        : node.width;
    const height =
      resizable && typeof visualState.height === 'number'
        ? snapToGrid(visualState.height)
        : node.height;

    return {
      ...node,
      position,
      width,
      height,
      style: {
        ...node.style,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      },
    };
  });
}

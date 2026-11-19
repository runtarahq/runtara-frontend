import {
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import {
  snapPositionToGrid,
  snapToGrid,
} from '@/features/workflows/config/workflow-editor';
import {
  NODE_TYPE_SIZES,
  NODE_TYPES,
  STEP_TYPES,
} from '@/features/workflows/config/workflow';
import type { WorkflowState } from '@/features/workflows/stores/workflow-state';
import type { StepNodeData } from '@/features/workflows/types/execution-graph';
import { validateConnection } from '@/features/workflows/utils/graph-validation';
import { generateStepId } from '@/features/workflows/utils/step-ids';

/**
 * Geometry of the canvas: where nodes go and what makes room for them.
 *
 * These work on the nodes and edges alone and change them in place, so the
 * store runs them inside an action (on its draft) and a test on plain arrays.
 * What an edit means for the workflow (dirty, staged, selected) stays in the
 * store.
 */

/** The nodes and edges of a canvas, changed in place. */
export interface CanvasGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Grows a container to hold all its children with padding. It only grows:
 * a container the user made larger keeps its size.
 */
export function expandParentToFitChildren(
  nodes: Node[],
  parentId: string
): void {
  const parentNode = nodes.find((n) => n.id === parentId);
  if (!parentNode) return;
  const childNodes = nodes.filter((n) => n.parentId === parentId);

  // Calculate required parent width and height to fit all children with padding
  const padding = 48; // Padding inside container
  let maxX = 0;
  let maxY = 0;

  childNodes.forEach((child) => {
    const childRight = child.position.x + (child.width || 180);
    const childBottom = child.position.y + (child.height || 48);
    maxX = Math.max(maxX, childRight);
    maxY = Math.max(maxY, childBottom);
  });

  const requiredWidth = snapToGrid(maxX + padding);
  const requiredHeight = snapToGrid(maxY + padding);

  // Only expand, never shrink
  const currentWidth =
    typeof parentNode.style?.width === 'number'
      ? parentNode.style.width
      : parentNode.width || 204;
  const currentHeight =
    typeof parentNode.style?.height === 'number'
      ? parentNode.style.height
      : parentNode.height || 168;

  if (requiredWidth > currentWidth || requiredHeight > currentHeight) {
    parentNode.width = Math.max(requiredWidth, currentWidth);
    parentNode.height = Math.max(requiredHeight, currentHeight);
    parentNode.style = {
      ...parentNode.style,
      width: Math.max(requiredWidth, currentWidth),
      height: Math.max(requiredHeight, currentHeight),
    };
  }
}

export interface InsertStepBetween {
  sourceNodeId: string;
  targetNodeId: string;
  /** The handle of the source the replaced edge left from. */
  sourceHandle: string;
  newStepData: StepNodeData;
}

/**
 * Puts a new step on the edge between two nodes: the nodes downstream move
 * right when there is no room, the edge is replaced by one into the step and
 * one (two, for a Conditional) out of it, and the container they are in
 * grows to hold it.
 *
 * Returns whether the step was inserted. It is not when either end is gone,
 * or when an edge it would need is not a valid connection.
 */
export function insertStepBetween(
  graph: CanvasGraph,
  { sourceNodeId, targetNodeId, sourceHandle, newStepData }: InsertStepBetween
): boolean {
  // Create new node ID
  const newNodeId =
    newStepData.id ||
    generateStepId(
      newStepData.name as string | undefined,
      graph.nodes.map((node) => node.id)
    );
  const nodeType = newStepData.stepType
    ? STEP_TYPES[newStepData.stepType as keyof typeof STEP_TYPES] ||
      NODE_TYPES.BasicNode
    : NODE_TYPES.BasicNode;
  const size = NODE_TYPE_SIZES[nodeType] || { width: 180, height: 48 }; // Pill fallback (15*12 x 4*12)

  // Find source and target nodes to calculate positioning
  const sourceNode = graph.nodes.find((n) => n.id === sourceNodeId);
  const targetNode = graph.nodes.find((n) => n.id === targetNodeId);

  if (!sourceNode || !targetNode) return false;

  // Calculate source node dimensions
  const sourceNodeWidth =
    typeof sourceNode.style?.width === 'number'
      ? sourceNode.style.width
      : typeof sourceNode.width === 'number'
        ? sourceNode.width
        : 96;

  // Calculate the space needed:
  // - From source right edge to new node left edge: 108px minimum
  // - New node width: size.width
  // - From new node right edge to target left edge: 108px minimum
  const minSpaceNeeded = snapToGrid(108 + size.width + 108);

  // Calculate current distance between source and target
  const sourceRightEdge = sourceNode.position.x + sourceNodeWidth;
  const currentDistance = targetNode.position.x - sourceRightEdge;

  // Determine how much we need to shift the target and downstream nodes
  const horizontalShift = Math.max(
    0,
    snapToGrid(minSpaceNeeded - currentDistance)
  );

  // Shift target node and all downstream nodes if needed
  if (horizontalShift > 0) {
    // Find all nodes that need to be shifted
    const nodesToShift = new Set<string>();

    // Helper function to find all downstream nodes recursively
    const findDownstreamNodes = (nodeId: string) => {
      graph.edges.forEach((edge) => {
        if (edge.source === nodeId) {
          const downstreamNode = graph.nodes.find((n) => n.id === edge.target);
          if (downstreamNode && !nodesToShift.has(edge.target)) {
            nodesToShift.add(edge.target);
            findDownstreamNodes(edge.target);
          }
        }
      });
    };

    // Start from the target node
    nodesToShift.add(targetNodeId);
    findDownstreamNodes(targetNodeId);

    // Shift all downstream nodes to the right
    graph.nodes = graph.nodes.map((node) => {
      if (nodesToShift.has(node.id)) {
        return {
          ...node,
          position: snapPositionToGrid({
            x: node.position.x + horizontalShift,
            y: node.position.y,
          }),
        };
      }
      return node;
    });
  }

  // Calculate the position for the new node AFTER shifting
  // Get the updated target position
  const targetNodeAfterShift = graph.nodes.find((n) => n.id === targetNodeId);
  const finalTargetX = targetNodeAfterShift
    ? targetNodeAfterShift.position.x
    : targetNode.position.x;

  // Position new node horizontally in the middle between source and shifted target
  const midpointX = (sourceRightEdge + finalTargetX) / 2;

  // Calculate Y position based on handle alignment (not simple averaging)
  // Get source node's type to determine its height from config
  const sourceNodeType = sourceNode.type || NODE_TYPES.BasicNode;
  const sourceNodeSize = NODE_TYPE_SIZES[sourceNodeType] || {
    width: 180,
    height: 48,
  };

  // Calculate source handle Y position (at center of source node)
  // NOTE: sourceNode.position is RELATIVE to parent if it has one
  const sourceHandleY = sourceNode.position.y + sourceNodeSize.height / 2;

  // Calculate new node Y so its handle aligns with source handle
  const newNodeHandleOffset = size.height / 2;
  const calculatedY = sourceHandleY - newNodeHandleOffset;

  // Calculate position for new node
  // Note: midpointX and calculatedY are already in the same coordinate space as sourceNode.position
  // If sourceNode has a parent, these are relative coordinates; otherwise they're absolute
  const newNodePosition = snapPositionToGrid({
    x: midpointX - size.width / 2,
    y: calculatedY,
  });

  // Create the new node
  // Inherit parentId from source node to maintain subgraph structure
  const newNode: Node = {
    id: newNodeId,
    type: nodeType,
    position: newNodePosition,
    data: {
      ...newStepData,
      id: newNodeId,
      inputMapping: newStepData.inputMapping || [],
    },
    style: {
      width: snapToGrid(size.width),
      height: snapToGrid(size.height),
    },
    ...(sourceNode.parentId && {
      parentId: sourceNode.parentId,
      extent: 'parent',
      expandParent: true,
    }),
  };

  // Add the new node
  graph.nodes.push(newNode);

  // Remove the old edge between source and target
  // Filter by source, target, and sourceHandle since edge IDs may have additional suffixes
  graph.edges = graph.edges.filter(
    (e) =>
      !(
        e.source === sourceNodeId &&
        e.target === targetNodeId &&
        e.sourceHandle === sourceHandle
      )
  );

  // Create new edges based on node type
  const isConditional = nodeType === NODE_TYPES.ConditionalNode;

  // First edge: source → new node (preserve original source handle)
  // Validate before adding
  const firstValidation = validateConnection(
    graph.edges,
    graph.nodes,
    sourceNodeId,
    newNodeId
  );
  if (!firstValidation.isValid) {
    console.error(
      `Cannot create edge from source to new node: ${firstValidation.errorMessage}`
    );
    return false;
  }

  const firstEdge: Edge = {
    id: `${sourceNodeId}-${newNodeId}-${sourceHandle}`,
    source: sourceNodeId,
    target: newNodeId,
    sourceHandle: sourceHandle || 'source',
    targetHandle: 'target',
  };
  graph.edges.push(firstEdge);

  // Second edge(s): new node → target
  if (isConditional) {
    // Validate before adding conditional edges
    const secondValidation = validateConnection(
      [...graph.edges],
      graph.nodes,
      newNodeId,
      targetNodeId
    );
    if (!secondValidation.isValid) {
      console.error(
        `Cannot create edge from new node to target: ${secondValidation.errorMessage}`
      );
      // Remove the first edge we just added
      graph.edges = graph.edges.filter((e) => e.id !== firstEdge.id);
      return false;
    }

    // Connect both true and false paths to target
    const trueEdge: Edge = {
      id: `${newNodeId}-${targetNodeId}-true`,
      source: newNodeId,
      target: targetNodeId,
      sourceHandle: 'true',
      targetHandle: 'target',
    };
    const falseEdge: Edge = {
      id: `${newNodeId}-${targetNodeId}-false`,
      source: newNodeId,
      target: targetNodeId,
      sourceHandle: 'false',
      targetHandle: 'target',
    };
    graph.edges.push(trueEdge, falseEdge);
  } else {
    // Validate before adding standard edge
    const secondValidation = validateConnection(
      [...graph.edges],
      graph.nodes,
      newNodeId,
      targetNodeId
    );
    if (!secondValidation.isValid) {
      console.error(
        `Cannot create edge from new node to target: ${secondValidation.errorMessage}`
      );
      // Remove the first edge we just added
      graph.edges = graph.edges.filter((e) => e.id !== firstEdge.id);
      return false;
    }

    // Standard single connection
    const secondEdge: Edge = {
      id: `${newNodeId}-${targetNodeId}-source`,
      source: newNodeId,
      target: targetNodeId,
      sourceHandle: 'source',
      targetHandle: 'target',
    };
    graph.edges.push(secondEdge);
  }

  // If new node has a parent, expand parent to fit all children
  if (sourceNode.parentId) {
    expandParentToFitChildren(graph.nodes, sourceNode.parentId);
  }

  return true;
}

/** A canvas with what it remembers of a container being resized. */
export interface ResizableCanvas extends CanvasGraph {
  resizeTracking: WorkflowState['resizeTracking'];
}

/**
 * Applies React Flow's node changes (resize, add, remove; a drag that also
 * resizes) to the canvas, in place, and returns the changes it applied.
 *
 * - Positions and container sizes are snapped to the grid.
 * - Only a container resizes, and only while the user drags one of its
 *   handles: React Flow also reports sizes when it re-measures a node or
 *   grows a parent during a drag, and taking those for a resize moved the
 *   steps after it.
 * - While a container's right edge is dragged, the steps downstream of it
 *   move with the edge, from where they were when the resize began
 *   (`resizeTracking`, cleared once a batch carries no size).
 */
export function applyCanvasNodeChanges(
  canvas: ResizableCanvas,
  changes: NodeChange[]
): NodeChange[] {
  // Track dimension changes for ContainerNodes to handle centering and downstream shifts
  const dimensionChanges = new Map<
    string,
    {
      oldWidth: number;
      oldHeight: number;
      newWidth: number;
      newHeight: number;
      oldPosition: { x: number; y: number };
    }
  >();

  // Check if this batch has any dimension changes
  const hasDimensionChanges = changes.some((c) => c.type === 'dimensions');

  // Check if this batch has position changes - if so, this is a drag operation
  // and we should skip dimension change processing to prevent infinite loops
  const hasPositionChanges = changes.some(
    (c) => c.type === 'position' && c.position
  );

  // Skip dimension change processing during drag operations
  // Dimension changes during drag are React Flow's expandParent behavior,
  // not user-initiated resizing
  const shouldProcessDimensions = hasDimensionChanges && !hasPositionChanges;

  // If no dimension changes, clear resize tracking (resize operation finished)
  if (!hasDimensionChanges && Object.keys(canvas.resizeTracking).length > 0) {
    canvas.resizeTracking = {};
  }

  // First pass: identify nodes being resized and initialize tracking
  // Skip this during drag operations to prevent infinite loops
  changes.forEach((change) => {
    if (change.type === 'dimensions' && shouldProcessDimensions) {
      const node = canvas.nodes.find((n) => n.id === change.id);
      if (node && node.type === NODE_TYPES.ContainerNode) {
        // Initialize resize tracking if this is the first resize event for this node
        if (!canvas.resizeTracking[change.id]) {
          const originalWidth =
            typeof node.style?.width === 'number'
              ? node.style.width
              : node.width || 204;
          const originalHeight =
            typeof node.style?.height === 'number'
              ? node.style.height
              : node.height || 168;

          // Find all downstream nodes and store their original positions
          const downstreamNodeOriginalPositions: Record<
            string,
            { x: number; y: number }
          > = {};
          const nodesToTrack = new Set<string>();
          const findDownstreamNodes = (currentNodeId: string) => {
            canvas.edges.forEach((edge) => {
              if (
                edge.source === currentNodeId &&
                !nodesToTrack.has(edge.target)
              ) {
                nodesToTrack.add(edge.target);
                findDownstreamNodes(edge.target);
              }
            });
          };
          findDownstreamNodes(change.id);

          // Store original positions of all downstream nodes
          nodesToTrack.forEach((nodeId) => {
            const downstreamNode = canvas.nodes.find((n) => n.id === nodeId);
            if (downstreamNode) {
              downstreamNodeOriginalPositions[nodeId] = {
                ...downstreamNode.position,
              };
            }
          });

          // Capture resize handle direction from node data
          const resizeHandle = node.data?.__resizeHandle as
            | {
                isLeft: boolean;
                isRight: boolean;
                isTop: boolean;
                isBottom: boolean;
              }
            | undefined;

          canvas.resizeTracking[change.id] = {
            originalPosition: { ...node.position },
            originalWidth,
            originalHeight,
            downstreamNodeOriginalPositions,
            resizeHandle,
          };
        }
      }
    }
  });

  // Filter and transform changes
  const snappedChanges = changes
    .filter((change) => {
      // Block dimension changes for non-container nodes to enforce fixed sizing
      if (change.type === 'dimensions') {
        const node = canvas.nodes.find((n) => n.id === change.id);
        if (node && node.type !== NODE_TYPES.ContainerNode) {
          return false; // Reject dimension changes for non-container nodes
        }

        // Skip dimension changes during drag operations to prevent infinite loops
        // During drag, React Flow fires dimension changes due to expandParent,
        // but we don't want to process them as resize operations
        if (!shouldProcessDimensions) {
          return false;
        }

        // Only allow dimension changes during active user resize
        // __resizeHandle is set by BaseResizableNode on resize start and cleared on end
        // Without this, React Flow's re-measurement on selection can trigger
        // unwanted container resizing and downstream node shifts
        if (node && !node.data?.__resizeHandle) {
          return false;
        }

        // Track ContainerNode dimension changes for downstream node shifting
        if (
          node &&
          node.type === NODE_TYPES.ContainerNode &&
          change.dimensions
        ) {
          // Use tracked original values, or current values if tracking not initialized
          const tracking = canvas.resizeTracking[change.id];
          const oldWidth =
            tracking?.originalWidth ||
            (typeof node.style?.width === 'number'
              ? node.style.width
              : node.width || 204);
          const oldHeight =
            tracking?.originalHeight ||
            (typeof node.style?.height === 'number'
              ? node.style.height
              : node.height || 168);
          const oldPosition = tracking?.originalPosition || {
            ...node.position,
          };

          dimensionChanges.set(change.id, {
            oldWidth,
            oldHeight,
            newWidth: change.dimensions.width,
            newHeight: change.dimensions.height,
            oldPosition,
          });
        }
      }
      return true;
    })
    .map((change) => {
      // Snap container dimension changes to grid
      if (change.type === 'dimensions' && change.dimensions) {
        return {
          ...change,
          dimensions: {
            width: snapToGrid(change.dimensions.width),
            height: snapToGrid(change.dimensions.height),
          },
        };
      }
      // Snap position changes to grid
      if (change.type === 'position' && change.position) {
        return {
          ...change,
          position: snapPositionToGrid(change.position),
        };
      }
      return change;
    });

  // Apply the changes first
  canvas.nodes = applyNodeChanges(snappedChanges, canvas.nodes);

  // Handle ContainerNode resizing: edge-based resizing based on handle direction
  dimensionChanges.forEach((changeInfo, nodeId) => {
    const { oldWidth, newWidth } = changeInfo;
    const widthDelta = newWidth - oldWidth;

    if (widthDelta !== 0) {
      const tracking = canvas.resizeTracking[nodeId];
      const handle = tracking?.resizeHandle;

      // React Flow's NodeResizer already handles position correctly:
      // - Right edge drag: keeps left edge fixed (position.x unchanged)
      // - Left edge drag: keeps right edge fixed (adjusts position.x)
      // We only need to shift downstream nodes based on how the right edge moved

      // Calculate how much the right edge moved in absolute coordinates
      let rightEdgeShift = 0;

      if (handle) {
        if (handle.isRight && !handle.isLeft) {
          // Right edge drag: right edge moved by full widthDelta
          rightEdgeShift = widthDelta;
        } else if (handle.isLeft && !handle.isRight) {
          // Left edge drag: right edge stayed in place (growth went left)
          rightEdgeShift = 0;
        } else {
          // Corner drag or both edges: shouldn't happen with standard handles
          rightEdgeShift = widthDelta / 2;
        }
      }

      // Shift downstream nodes based on right edge movement
      if (rightEdgeShift !== 0 && tracking?.downstreamNodeOriginalPositions) {
        canvas.nodes.forEach((node) => {
          const originalPos = tracking.downstreamNodeOriginalPositions[node.id];
          if (originalPos) {
            node.position = {
              x: originalPos.x + rightEdgeShift,
              y: node.position.y, // Keep Y unchanged
            };
          }
        });
      }
    }
  });

  return snappedChanges;
}

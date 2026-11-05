import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { cn } from '@/lib/utils';
import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
} from '@/features/workflows/config/workflow';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { getLayoutedElements } from './CustomNodes/utils';
import type { CanvasDetailLevel } from './CustomNodes/node-size';
import {
  noteAnchorStepId,
  resolveNotePositions,
  type Point,
} from './CustomNodes/note-placement';
import { CANVAS_Z } from './canvas-z';
import type { CreateStepContext } from './index';

interface CanvasLayoutOptions {
  nodes: Node[];
  edges: Edge[];
  entryPoint?: string;
  canvasDetail: CanvasDetailLevel;
  readOnly: boolean;
  selectedEdgeId: string | null;
  setCreateStepContext: (context: CreateStepContext | null) => void;
}

/** Derives the render graph: layout, inline agent tools, notes, and start marker. */
export function useCanvasLayout({
  nodes,
  edges,
  entryPoint,
  canvasDetail,
  readOnly,
  selectedEdgeId,
  setCreateStepContext,
}: CanvasLayoutOptions) {
  const placeNote = useWorkflowStore((state) => state.placeNote);
  // Virtual Start Indicator
  const entryPointId = useMemo(() => {
    const workflowNodes = nodes.filter(
      (n) =>
        n.type !== NODE_TYPES.NoteNode &&
        n.type !== NODE_TYPES.CreateNode &&
        n.type !== NODE_TYPES.StartIndicatorNode &&
        !n.parentId
    );

    if (workflowNodes.length === 0) return null;
    if (entryPoint) {
      const explicitEntryPoint = workflowNodes.find(
        (node) => node.id === entryPoint
      );
      if (explicitEntryPoint) return explicitEntryPoint.id;
    }

    const nodesWithIncomingEdges = new Set(
      edges
        .filter((e) => e.source !== '__start_indicator__')
        .map((e) => e.target)
    );

    // Find all nodes without incoming edges (potential entry points)
    const candidateNodes = workflowNodes.filter(
      (n) => !nodesWithIncomingEdges.has(n.id)
    );

    if (candidateNodes.length === 0) return null;

    // If multiple candidates, pick the leftmost one (smallest x position)
    // This ensures the Start indicator stays stable when edges are deleted
    const entryPointNode = candidateNodes.reduce((leftmost, node) =>
      node.position.x < leftmost.position.x ? node : leftmost
    );

    return entryPointNode?.id || null;
  }, [nodes, edges, entryPoint]);

  // Identify AI Agent tool/memory nodes and edges to hide from canvas.
  // Tool steps are rendered inline in the AI Agent card, so their separate
  // nodes and connecting edges should not appear on the canvas.
  const { hiddenNodeIds, hiddenEdgeIds } = useMemo(() => {
    const hiddenNodes = new Set<string>();
    const hiddenEdges = new Set<string>();

    // Find all AI Agent nodes
    const aiAgentNodes = nodes.filter((n) => n.type === NODE_TYPES.AiAgentNode);

    for (const agentNode of aiAgentNodes) {
      // Find edges from this AI Agent whose sourceHandle is a tool name,
      // 'memory' or an mcp.<toolset> route (any handle that is NOT the
      // standard 'source' output). 'onError' is a normal error route — the
      // handler stays visible on the canvas like any other error branch.
      for (const edge of edges) {
        if (
          edge.source === agentNode.id &&
          edge.sourceHandle &&
          edge.sourceHandle !== 'source' &&
          edge.sourceHandle !== 'onError'
        ) {
          hiddenEdges.add(edge.id);
          hiddenNodes.add(edge.target);
        }
      }
    }

    return { hiddenNodeIds: hiddenNodes, hiddenEdgeIds: hiddenEdges };
  }, [nodes, edges]);

  const visibleCanvasNodes = useMemo(
    () =>
      hiddenNodeIds.size > 0
        ? nodes.filter((node) => !hiddenNodeIds.has(node.id))
        : nodes,
    [hiddenNodeIds, nodes]
  );

  const visibleCanvasEdges = useMemo(
    () => edges.filter((edge) => !hiddenEdgeIds.has(edge.id)),
    [edges, hiddenEdgeIds]
  );

  const layoutedCanvas = useMemo(() => {
    const layout = getLayoutedElements(visibleCanvasNodes, visibleCanvasEdges, {
      detailLevel: canvasDetail,
    });

    const stepNameById = new Map(
      layout.nodes.map((node) => [
        node.id,
        typeof node.data?.name === 'string' && node.data.name
          ? node.data.name
          : node.id,
      ])
    );

    return {
      // Anchored notes follow their step: resolve them after the layout has
      // placed the steps. Only notes move by hand, and only by their header.
      nodes: resolveNotePositions(layout.nodes).map((node) => {
        if (node.type !== NODE_TYPES.NoteNode) {
          return { ...node, draggable: false };
        }
        const anchor = noteAnchorStepId(node);
        return {
          ...node,
          draggable: !readOnly,
          dragHandle: '.note-drag-handle',
          data: {
            ...node.data,
            anchorStepName: anchor ? stepNameById.get(anchor) : undefined,
          },
        };
      }),
      edgeRoutes: layout.edgeRoutes ?? {},
    };
  }, [canvasDetail, readOnly, visibleCanvasEdges, visibleCanvasNodes]);
  const layoutedCanvasNodes = layoutedCanvas.nodes;
  const layoutedCanvasEdgeRoutes = layoutedCanvas.edgeRoutes;

  const entryPointNode = entryPointId
    ? layoutedCanvasNodes.find((n) => n.id === entryPointId)
    : null;

  const startIndicatorNode: Node | null = useMemo(() => {
    const startIndicatorSize = NODE_TYPE_SIZES[NODE_TYPES.StartIndicatorNode];

    if (entryPointNode) {
      // Use the node's actual rendered dimensions, not config defaults.
      // Containers/resizable nodes can be much larger than their default config size.
      const entryPointHeight =
        (entryPointNode.style?.height as number) ||
        (entryPointNode.height as number) ||
        NODE_TYPE_SIZES[entryPointNode.type || NODE_TYPES.BasicNode]?.height ||
        48;

      return {
        id: '__start_indicator__',
        type: NODE_TYPES.StartIndicatorNode,
        position: {
          x: entryPointNode.position.x - startIndicatorSize.width - 60,
          y:
            entryPointNode.position.y +
            entryPointHeight / 2 -
            startIndicatorSize.height / 2,
        },
        data: { hasEntryPoint: true },
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        style: {
          width: startIndicatorSize.width,
          height: startIndicatorSize.height,
        },
      };
    }

    return {
      id: '__start_indicator__',
      type: NODE_TYPES.StartIndicatorNode,
      position: { x: 0, y: 0 },
      data: {
        hasEntryPoint: false,
        onAddFirstStep: () => {
          const defaultNodeHeight = 48;
          setCreateStepContext({
            position: {
              x: startIndicatorSize.width + 60,
              y: (startIndicatorSize.height - defaultNodeHeight) / 2,
            },
          });
        },
      },
      selectable: false,
      draggable: false,
      connectable: false,
      deletable: false,
      style: {
        width: startIndicatorSize.width,
        height: startIndicatorSize.height,
      },
    };
  }, [entryPointNode, setCreateStepContext]);

  const startIndicatorEdge: Edge | null = useMemo(() => {
    if (!entryPointId) return null;

    return {
      id: '__start_indicator_edge__',
      type: 'default',
      source: '__start_indicator__',
      target: entryPointId,
      sourceHandle: 'source',
      targetHandle: 'target',
      selectable: true,
      deletable: false,
      data: {},
    };
  }, [entryPointId]);

  // Every canvas node renders at exactly its layout size (see node-size.ts),
  // so React Flow is told that size up front instead of measuring it. This
  // canvas drops React Flow's dimension changes (the measurements must not
  // reach the workflow store), so without `measured` React Flow never
  // considers the nodes initialized and the viewport is never fitted.
  // A note being dragged: the layout owns every position, so the live drag
  // position is applied on top of it until the drop is committed.
  const [noteDrag, setNoteDrag] = useState<{
    id: string;
    position: Point;
    attachTo: string | null;
  } | null>(null);

  const nodesWithStartIndicator = useMemo(() => {
    const laidOut = noteDrag
      ? layoutedCanvasNodes.map((node) => {
          if (node.id === noteDrag.id) {
            return { ...node, position: noteDrag.position, dragging: true };
          }
          if (node.id === noteDrag.attachTo) {
            return {
              ...node,
              className: cn(node.className, 'note-attach-target'),
            };
          }
          return node;
        })
      : layoutedCanvasNodes;
    const canvasNodes = startIndicatorNode
      ? [startIndicatorNode, ...laidOut]
      : laidOut;
    return canvasNodes.map((node) => {
      const width = node.style?.width;
      const height = node.style?.height;
      return typeof width === 'number' && typeof height === 'number'
        ? { ...node, measured: { width, height } }
        : node;
    });
  }, [layoutedCanvasNodes, noteDrag, startIndicatorNode]);

  // A note whose step was deleted becomes a free note where it last stood,
  // instead of jumping to its offset read as absolute coordinates.
  const lastNotePositions = useRef(new Map<string, Point>());
  useEffect(() => {
    const stepIds = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      const anchor = noteAnchorStepId(node);
      if (node.type === NODE_TYPES.NoteNode && anchor && !stepIds.has(anchor)) {
        placeNote(
          node.id,
          lastNotePositions.current.get(node.id) ?? node.position,
          null
        );
      }
    }
    for (const node of layoutedCanvasNodes) {
      if (node.type === NODE_TYPES.NoteNode) {
        lastNotePositions.current.set(node.id, node.position);
      }
    }
  }, [layoutedCanvasNodes, nodes, placeNote]);

  const edgesWithStartIndicator = useMemo(() => {
    const visibleNodeIds = new Set(layoutedCanvasNodes.map((node) => node.id));
    // Create a set of node IDs that are inside a container (have parentId)
    const nodesInsideContainer = new Set(
      layoutedCanvasNodes.filter((n) => n.parentId).map((n) => n.id)
    );

    // Filter out hidden tool/memory edges and apply selection
    const edgesWithSelection = visibleCanvasEdges
      .filter(
        (edge) =>
          visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      )
      .map((edge) => {
        // Check if this edge connects nodes inside a container
        const isInsideContainer =
          nodesInsideContainer.has(edge.source) ||
          nodesInsideContainer.has(edge.target);

        return {
          ...edge,
          type: edge.type || 'default',
          targetHandle: edge.targetHandle || 'target',
          selected: edge.id === selectedEdgeId,
          // Edges inside containers need higher zIndex to appear above the container background
          zIndex: isInsideContainer ? CANVAS_Z.edgeInContainer : CANVAS_Z.edge,
        };
      });

    if (!startIndicatorEdge) return edgesWithSelection;

    return [
      {
        ...startIndicatorEdge,
        selected: selectedEdgeId === '__start_indicator_edge__',
      },
      ...edgesWithSelection,
    ];
  }, [
    layoutedCanvasNodes,
    selectedEdgeId,
    startIndicatorEdge,
    visibleCanvasEdges,
  ]);

  return {
    visibleCanvasNodes,
    layoutedCanvasNodes,
    layoutedCanvasEdgeRoutes,
    nodesWithStartIndicator,
    edgesWithStartIndicator,
    setNoteDrag,
  };
}

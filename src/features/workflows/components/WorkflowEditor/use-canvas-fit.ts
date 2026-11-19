import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  getViewportForBounds,
  useNodesInitialized,
  useReactFlow,
  useStoreApi,
  type Edge,
  type Node,
  type Rect,
  type Viewport,
} from '@xyflow/react';
import {
  NODE_TYPE_SIZES,
  NODE_TYPES,
} from '@/features/workflows/config/workflow';
import type { CanvasDetailLevel } from './CustomNodes/node-size';

// Long workflows are several thousand pixels wide; React Flow's default
// minimum zoom (0.5) cannot fit them, so fit-to-view silently clipped both
// ends. Fitting never zooms past 100%: a two-step workflow blown up to 2x
// reads as broken, not as "fitted".
export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };
// Below this zoom card text is unreadable. A workflow too long to fit above it
// opens at this zoom, anchored on its start, and the Fit button shows it all.
const CANVAS_READABLE_ZOOM = 0.8;
const CANVAS_VIEW_MARGIN = 48;

/**
 * The view a workflow opens in: all of it, when that leaves its cards
 * readable; otherwise at the lowest readable zoom, from its start, centred
 * vertically if its height fits.
 *
 * `null` when the pane or the workflow has no size yet, and there is nothing
 * to compute from.
 */
export function readableViewport(
  bounds: Rect,
  width: number,
  height: number
): Viewport | null {
  if (!width || !height || bounds.width === 0 || bounds.height === 0) {
    return null;
  }
  const fitted = getViewportForBounds(
    bounds,
    width,
    height,
    CANVAS_MIN_ZOOM,
    CANVAS_FIT_VIEW_OPTIONS.maxZoom,
    CANVAS_FIT_VIEW_OPTIONS.padding
  );
  if (fitted.zoom >= CANVAS_READABLE_ZOOM) {
    return fitted;
  }
  const zoom = CANVAS_READABLE_ZOOM;
  const contentHeight = bounds.height * zoom;
  return {
    zoom,
    x: CANVAS_VIEW_MARGIN - bounds.x * zoom,
    y:
      contentHeight + CANVAS_VIEW_MARGIN * 2 <= height
        ? (height - contentHeight) / 2 - bounds.y * zoom
        : CANVAS_VIEW_MARGIN - bounds.y * zoom,
  };
}

/**
 * What the view is fitted to: which steps and edges exist, and the detail
 * level. Deliberately not sizes or positions — editing a step can grow its
 * card, and re-fitting on that would yank the view mid-edit. Not notes
 * either: adding one would move the camera away from the new note.
 */
export function canvasFitKey(
  nodes: Node[],
  edges: Edge[],
  canvasDetail: CanvasDetailLevel | undefined
): string {
  return JSON.stringify({
    detail: canvasDetail,
    nodes: nodes
      .filter((node) => node.type !== NODE_TYPES.NoteNode)
      .map((node) => node.id),
    edges: edges.map((edge) => edge.id),
  });
}

/**
 * Fits the view to the workflow once per `canvasFitKey`: when it is opened,
 * and when a step or an edge is added or removed or the detail level changes.
 * An empty workflow centres on its Start indicator.
 */
export function useCanvasFit({
  nodes,
  edges,
  canvasDetail,
  visibleNodeCount,
}: {
  /** The canvas's nodes and edges, Start indicator included. */
  nodes: Node[];
  edges: Edge[];
  canvasDetail: CanvasDetailLevel | undefined;
  /** How many of the nodes are steps or notes the user sees. */
  visibleNodeCount: number;
}) {
  const { getNodesBounds, fitView, setCenter, setViewport } = useReactFlow();
  const reactFlowStore = useStoreApi();
  const lastFittedKeyRef = useRef<string | null>(null);

  const fitKey = useMemo(
    () => canvasFitKey(nodes, edges, canvasDetail),
    [canvasDetail, edges, nodes]
  );

  const fitCanvasReadable = useCallback(() => {
    const { width, height } = reactFlowStore.getState();
    const viewport = readableViewport(getNodesBounds(nodes), width, height);
    if (viewport) {
      setViewport(viewport, { duration: 200 });
    } else {
      fitView({ duration: 200, ...CANVAS_FIT_VIEW_OPTIONS });
    }
  }, [fitView, getNodesBounds, nodes, reactFlowStore, setViewport]);

  // Fit only once React Flow has measured every node: fitting earlier uses
  // partial bounds and leaves part of the workflow off-screen.
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    if (
      lastFittedKeyRef.current === fitKey ||
      (visibleNodeCount > 0 && !nodesInitialized)
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (visibleNodeCount > 0) {
        fitCanvasReadable();
      } else {
        const startIndicatorSize =
          NODE_TYPE_SIZES[NODE_TYPES.StartIndicatorNode];
        setCenter(startIndicatorSize.width / 2, startIndicatorSize.height / 2, {
          zoom: 1,
          duration: 200,
        });
      }

      lastFittedKeyRef.current = fitKey;
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [
    fitKey,
    fitCanvasReadable,
    nodesInitialized,
    setCenter,
    visibleNodeCount,
  ]);
}

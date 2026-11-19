import type { XYPosition } from '@xyflow/react';
import { createStore } from 'zustand';

import { editorStore } from '@/features/workflows/stores/editor-scope';

type Mapper = (point: XYPosition) => XYPosition;

/**
 * Screen → canvas coordinates for code outside the canvas.
 *
 * The editor wraps the canvas in its own ReactFlowProvider, so a
 * `useReactFlow()` higher up (the workflow page's toolbar) talks to a
 * different, never-rendered instance: its viewport is always the identity,
 * which is why toolbar-added notes landed at arbitrary spots. The canvas
 * registers its real mapping here while it is mounted, with the rest of its
 * editor's state.
 */
const canvasBridge = editorStore('canvasBridge', () =>
  createStore<{ mapper: Mapper | null }>(() => ({ mapper: null }))
);

export function registerScreenToCanvas(mapper: Mapper | null) {
  canvasBridge.setState({ mapper });
}

/** Canvas coordinates of a screen point, or null when no canvas is mounted. */
export function screenToCanvas(point: XYPosition): XYPosition | null {
  const { mapper } = canvasBridge.getState();
  return mapper ? mapper(point) : null;
}

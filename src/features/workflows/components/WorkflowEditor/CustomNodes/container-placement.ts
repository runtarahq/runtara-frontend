import type { Node } from '@xyflow/react';

// Where a step created from a container goes. A container nested in
// another has a position relative to that parent, and a step that follows
// it, or handles its error, is a sibling: it has the same parent, and its
// position is relative to it too.

interface Size {
  width: number;
  height: number;
}

type Placement = {
  position: { x: number; y: number };
  parentId: string | undefined;
};

/** A step after the container, level with its handle. */
export function placeAfterContainer(
  container: Node,
  containerSize: Size,
  newStep: Size
): Placement {
  return {
    position: {
      // Snapped to the grid by the store.
      x: container.position.x + containerSize.width + 108,
      // Handles sit at a step's middle: keep them level.
      y: container.position.y + containerSize.height / 2 - newStep.height / 2,
    },
    parentId: container.parentId,
  };
}

/** The container's error handler, below its middle. */
export function placeContainerErrorHandler(
  container: Node,
  containerSize: Size,
  newStep: Size
): Placement {
  return {
    position: {
      x: container.position.x + containerSize.width / 2 - newStep.width / 2,
      y: container.position.y + containerSize.height + 80,
    },
    parentId: container.parentId,
  };
}

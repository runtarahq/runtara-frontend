import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  placeAfterContainer,
  placeContainerErrorHandler,
} from './container-placement';

const container = (parentId?: string) =>
  ({
    id: 'inner',
    position: { x: 40, y: 60 },
    data: {},
    ...(parentId ? { parentId } : {}),
  }) as Node;

const containerSize = { width: 200, height: 168 };
const step = { width: 100, height: 48 };

describe('a step created from a container', () => {
  it('follows a top-level container at the top level, level with its handle', () => {
    expect(placeAfterContainer(container(), containerSize, step)).toEqual({
      position: { x: 40 + 200 + 108, y: 60 + 84 - 24 },
      parentId: undefined,
    });
  });

  it('follows a nested container inside the same parent, not at the top level', () => {
    // It used to be given no parent: the step landed outside every
    // container, wired to a step it could not reach.
    const placement = placeAfterContainer(
      container('outer'),
      containerSize,
      step
    );

    expect(placement.parentId).toBe('outer');
    // Relative to that parent, as the container's own position is.
    expect(placement.position).toEqual({ x: 348, y: 120 });
  });

  it('puts a container’s error handler below its middle, in the same parent', () => {
    expect(
      placeContainerErrorHandler(container('outer'), containerSize, step)
    ).toEqual({
      position: { x: 40 + 100 - 50, y: 60 + 168 + 80 },
      parentId: 'outer',
    });
    expect(
      placeContainerErrorHandler(container(), containerSize, step).parentId
    ).toBeUndefined();
  });
});

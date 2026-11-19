import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@/features/workflows/config/workflow';
import { canvasFitKey, readableViewport } from './use-canvas-fit';

const PANE = { width: 1200, height: 800 };
const view = (bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => readableViewport(bounds, PANE.width, PANE.height);

describe('readableViewport', () => {
  it('shows all of a workflow that fits, and never blows it up past 100%', () => {
    const small = view({ x: 0, y: 0, width: 400, height: 100 })!;
    expect(small.zoom).toBe(1);
    // Centred in the pane.
    expect(small.x).toBeCloseTo((1200 - 400) / 2);
    expect(small.y).toBeCloseTo((800 - 100) / 2);
  });

  it('zooms out to fit a workflow while its cards stay readable', () => {
    const wide = view({ x: 0, y: 0, width: 1300, height: 100 })!;
    expect(wide.zoom).toBeGreaterThanOrEqual(0.8);
    expect(wide.zoom).toBeLessThan(1);
    // All of it is in view.
    expect(wide.x).toBeGreaterThanOrEqual(0);
    expect(wide.x + 1300 * wide.zoom).toBeLessThanOrEqual(1200);
  });

  it('opens a workflow too long to read when fitted at the readable zoom, from its start', () => {
    const long = view({ x: 240, y: 60, width: 6000, height: 100 })!;
    expect(long.zoom).toBe(0.8);
    // Its left edge a margin in from the pane's.
    expect(long.x).toBe(48 - 240 * 0.8);
    // Centred vertically: its height fits.
    expect(long.y).toBeCloseTo((800 - 100 * 0.8) / 2 - 60 * 0.8);
  });

  it('starts a workflow too tall as well from its top', () => {
    const big = view({ x: 0, y: 120, width: 6000, height: 2000 })!;
    expect(big.zoom).toBe(0.8);
    expect(big.y).toBe(48 - 120 * 0.8);
  });

  it('has nothing to compute before the pane or the workflow has a size', () => {
    expect(
      readableViewport({ x: 0, y: 0, width: 400, height: 100 }, 0, 800)
    ).toBeNull();
    expect(view({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('canvasFitKey', () => {
  const node = (id: string, over: Partial<Node> = {}): Node => ({
    id,
    position: { x: 0, y: 0 },
    data: {},
    ...over,
  });
  const edge = (id: string): Edge => ({ id, source: 'a', target: 'b' });
  const nodes = [node('a'), node('b')];
  const key = canvasFitKey(nodes, [edge('a-b')], 'compact');

  it('stays the same when a step moves, grows or is edited', () => {
    const moved = [
      node('a', {
        position: { x: 500, y: 40 },
        width: 400,
        data: { name: 'x' },
      }),
      node('b'),
    ];
    expect(canvasFitKey(moved, [edge('a-b')], 'compact')).toBe(key);
  });

  it('stays the same when a note is added', () => {
    const withNote = [...nodes, node('note-1', { type: NODE_TYPES.NoteNode })];
    expect(canvasFitKey(withNote, [edge('a-b')], 'compact')).toBe(key);
  });

  it('changes when a step or an edge is added, or the detail level changes', () => {
    expect(
      canvasFitKey([...nodes, node('c')], [edge('a-b')], 'compact')
    ).not.toBe(key);
    expect(canvasFitKey(nodes, [edge('a-b'), edge('b-c')], 'compact')).not.toBe(
      key
    );
    expect(canvasFitKey(nodes, [edge('a-b')], 'detailed')).not.toBe(key);
  });
});

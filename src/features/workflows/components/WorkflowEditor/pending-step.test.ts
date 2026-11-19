import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
} from '@/features/workflows/config/workflow';
import {
  generateUniqueStepName,
  pendingStepEdges,
  planPendingStep,
  type CreateStepContext,
  type PendingStep,
} from './pending-step';

const node = (id: string, over: Partial<Node> = {}): Node => ({
  id,
  type: NODE_TYPES.BasicNode,
  position: { x: 0, y: 0 },
  width: 216,
  height: 60,
  data: { id, name: id, stepType: 'Agent' },
  ...over,
});

const container = (id: string, x: number, y: number, parentId?: string) =>
  node(id, {
    type: NODE_TYPES.ContainerNode,
    position: { x, y },
    width: 600,
    height: 300,
    ...(parentId ? { parentId } : {}),
  });

const plan = (
  context: CreateStepContext,
  nodes: Node[],
  over: { stepType?: string; name?: string; intersecting?: Node[] } = {}
) =>
  planPendingStep({
    picked: {
      stepType: over.stepType ?? 'Agent',
      name: over.name ?? 'Send email',
      agentId: 'smtp',
      capabilityId: 'send',
    },
    context,
    nodes,
    initialData: { inputMapping: [], durable: true },
    intersecting: () => over.intersecting ?? [],
  });

const basic = NODE_TYPE_SIZES[NODE_TYPES.BasicNode];

describe('generateUniqueStepName', () => {
  const named = (...names: string[]) =>
    names.map((name, i) => node(`n${i}`, { data: { name } }));

  it('keeps a name no step has', () => {
    expect(generateUniqueStepName('Send email', named('Fetch'))).toBe(
      'Send email'
    );
  });

  it('takes the next free number for a name in use', () => {
    expect(generateUniqueStepName('Send email', named('Send email'))).toBe(
      'Send email 2'
    );
    expect(
      generateUniqueStepName(
        'Send email',
        named('Send email', 'Send email 2', 'Send email 4')
      )
    ).toBe('Send email 3');
  });
});

describe('planPendingStep', () => {
  it('starts the step from the form defaults, named and typed as picked', () => {
    const pending = plan({ position: { x: 120, y: 240 } }, []);
    expect(pending.data).toEqual({
      inputMapping: [],
      durable: true,
      stepType: 'Agent',
      name: 'Send email',
      agentId: 'smtp',
      capabilityId: 'send',
    });
    expect(pending.id).toBe('send_email');
  });

  it('gives it a name and an id no step has', () => {
    const existing = node('send_email', { data: { name: 'Send email' } });
    const pending = plan({ position: { x: 0, y: 0 } }, [existing]);
    expect(pending.data.name).toBe('Send email 2');
    expect(pending.id).not.toBe('send_email');
  });

  describe('on empty canvas', () => {
    it('goes where it was dropped', () => {
      const pending = plan({ position: { x: 120, y: 240 } }, []);
      expect(pending).toMatchObject({ position: { x: 120, y: 240 } });
      expect(pending.parentId).toBeUndefined();
      expect(pending.sourceNodeId).toBeUndefined();
      expect(pending.insertionEdge).toBeUndefined();
    });

    it('lands in the innermost container under it', () => {
      const outer = container('outer', 0, 0);
      const inner = container('inner', 48, 48, 'outer');
      const pending = plan({ position: { x: 120, y: 120 } }, [outer, inner], {
        intersecting: [outer, node('plain'), inner],
      });
      expect(pending.parentId).toBe('inner');
    });

    it('stays in the container it was asked for, whatever is under it', () => {
      const other = container('other', 0, 0);
      const pending = plan(
        { position: { x: 24, y: 24 }, parentId: 'asked' },
        [other],
        { intersecting: [other] }
      );
      expect(pending).toMatchObject({
        parentId: 'asked',
        position: { x: 24, y: 24 },
      });
    });
  });

  describe('from a dragged connection', () => {
    it('is level with the handle it was dragged from, and wired to it', () => {
      const source = node('a', { position: { x: 0, y: 120 }, height: 60 });
      const pending = plan(
        {
          position: { x: 400, y: 999 },
          connection: { source: 'a', sourceHandle: 'true' },
        },
        [source]
      );
      expect(pending).toMatchObject({
        sourceNodeId: 'a',
        sourceHandle: 'true',
        position: { x: 400, y: 120 + 30 - basic.height / 2 },
      });
      expect(pending.parentId).toBeUndefined();
    });

    it("is placed inside the source's container, relative to it", () => {
      const split = container('split', 300, 200);
      const source = node('a', {
        parentId: 'split',
        position: { x: 24, y: 48 },
      });
      const pending = plan(
        {
          position: { x: 700, y: 0 },
          connection: { source: 'a', sourceHandle: 'source' },
        },
        [split, source]
      );
      expect(pending.parentId).toBe('split');
      // The asked x, and the handle's y, both from the container's corner.
      expect(pending.position).toEqual({
        x: 700 - 300,
        y: 48 + 30 - basic.height / 2,
      });
    });
  });

  describe('on an edge', () => {
    const edge = { source: 'a', target: 'b', sourceHandle: 'source' };

    it('replaces the edge, at the asked position', () => {
      const pending = plan(
        { position: { x: 300, y: 12 }, insertionEdge: edge },
        [node('a'), node('b')]
      );
      expect(pending).toMatchObject({
        position: { x: 300, y: 12 },
        insertionEdge: edge,
      });
      expect(pending.becomesEntryPoint).toBeUndefined();
    });

    it('goes left of the first step, level with it, on the edge from Start', () => {
      const first = node('first', { position: { x: 480, y: 120 }, height: 60 });
      const pending = plan(
        {
          position: { x: 0, y: 0 },
          insertionEdge: {
            source: '__start_indicator__',
            target: 'first',
            sourceHandle: 'source',
          },
        },
        [first]
      );
      expect(pending).toMatchObject({
        targetNodeId: 'first',
        becomesEntryPoint: true,
        position: { x: 480 - basic.width - 108, y: 120 },
      });
      expect(pending.insertionEdge).toBeUndefined();
    });
  });

  describe('as a parallel branch over an edge', () => {
    const branch = { source: 'a', target: 'b', sourceHandle: 'source' };

    it('is wired from the source to the target, the edge kept', () => {
      const pending = plan(
        { position: { x: 300, y: 200 }, parallelBranch: branch },
        [node('a'), node('b')]
      );
      expect(pending).toMatchObject({
        sourceNodeId: 'a',
        targetNodeId: 'b',
        sourceHandle: 'source',
        position: { x: 300, y: 200 },
      });
      expect(pending.insertionEdge).toBeUndefined();
    });

    it("is placed in the source's container, through every level of nesting", () => {
      const outer = container('outer', 100, 100);
      const inner = container('inner', 50, 60, 'outer');
      const source = node('a', { parentId: 'inner' });
      const pending = plan(
        { position: { x: 400, y: 400 }, parallelBranch: branch },
        [outer, inner, source, node('b', { parentId: 'inner' })]
      );
      expect(pending.parentId).toBe('inner');
      expect(pending.position).toEqual({ x: 400 - 150, y: 400 - 160 });
    });
  });
});

describe('pendingStepEdges', () => {
  const pending = (over: Partial<PendingStep>): PendingStep => ({
    id: 'new',
    data: { name: 'New', stepType: 'Agent' },
    position: { x: 0, y: 0 },
    ...over,
  });

  it('wires nothing for a step that replaces an edge: the insert rewires it', () => {
    expect(
      pendingStepEdges(
        pending({
          insertionEdge: { source: 'a', target: 'b', sourceHandle: 'source' },
        }),
        'new',
        false
      )
    ).toEqual([]);
  });

  it('wires nothing for a step dropped on empty canvas', () => {
    expect(pendingStepEdges(pending({}), 'new', false)).toEqual([]);
  });

  it('wires a dragged connection from the handle it left', () => {
    expect(
      pendingStepEdges(
        pending({ sourceNodeId: 'a', sourceHandle: 'true' }),
        'new',
        false
      )
    ).toEqual([{ from: 'a', to: 'new', label: 'true' }]);
    expect(
      pendingStepEdges(pending({ sourceNodeId: 'a' }), 'new', false)
    ).toEqual([{ from: 'a', to: 'new', label: 'source' }]);
  });

  it('wires a step before the first one on to it', () => {
    expect(
      pendingStepEdges(pending({ targetNodeId: 'first' }), 'new', false)
    ).toEqual([{ from: 'new', to: 'first', label: 'source' }]);
  });

  it('wires both legs of a parallel branch, the leg from the source first', () => {
    expect(
      pendingStepEdges(
        pending({
          sourceNodeId: 'a',
          targetNodeId: 'b',
          sourceHandle: 'case-1',
        }),
        'new',
        false
      )
    ).toEqual([
      { from: 'a', to: 'new', label: 'case-1' },
      { from: 'new', to: 'b', label: 'source' },
    ]);
  });

  it('leads both branches of a Conditional on to the target', () => {
    expect(
      pendingStepEdges(pending({ targetNodeId: 'first' }), 'new', true)
    ).toEqual([
      { from: 'new', to: 'first', label: 'true' },
      { from: 'new', to: 'first', label: 'false' },
    ]);
    expect(
      pendingStepEdges(
        pending({ sourceNodeId: 'a', targetNodeId: 'b' }),
        'new',
        true
      )
    ).toEqual([
      { from: 'a', to: 'new', label: 'source' },
      { from: 'new', to: 'b', label: 'true' },
      { from: 'new', to: 'b', label: 'false' },
    ]);
  });

  it('uses the id the canvas gave the step, not the one it was planned with', () => {
    expect(
      pendingStepEdges(pending({ sourceNodeId: 'a' }), 'new_2', false)
    ).toEqual([{ from: 'a', to: 'new_2', label: 'source' }]);
  });
});

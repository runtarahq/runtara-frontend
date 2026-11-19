import type { Edge, Node } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@/features/workflows/config/workflow';
import {
  applyCanvasNodeChanges,
  expandParentToFitChildren,
  insertStepBetween,
  type CanvasGraph,
  type ResizableCanvas,
} from './canvas-geometry';
import { useWorkflowStore } from './workflowStore';

const step = (id: string, x: number, over: Partial<Node> = {}): Node => ({
  id,
  type: NODE_TYPES.BasicNode,
  position: { x, y: 0 },
  width: 216,
  height: 60,
  data: { id, name: id, stepType: 'Agent' },
  ...over,
});

const edge = (source: string, target: string, handle = 'source'): Edge => ({
  id: `${source}-${target}-${handle}`,
  source,
  target,
  sourceHandle: handle,
  targetHandle: 'target',
});

/** a → b → c, close together. */
const chain = (): CanvasGraph => ({
  nodes: [step('a', 0), step('b', 324), step('c', 648)],
  edges: [edge('a', 'b'), edge('b', 'c')],
});

const insert = (graph: CanvasGraph, stepType = 'Agent', name = 'New step') =>
  insertStepBetween(graph, {
    sourceNodeId: 'a',
    targetNodeId: 'b',
    sourceHandle: 'source',
    newStepData: { name, stepType: stepType as 'Agent' },
  });

const links = (graph: CanvasGraph) =>
  graph.edges.map((e) => `${e.source}>${e.target}:${e.sourceHandle}`).sort();

describe('insertStepBetween', () => {
  it('puts the step on the edge, in place of it', () => {
    const graph = chain();
    expect(insert(graph)).toBe(true);
    const added = graph.nodes.find((n) => !['a', 'b', 'c'].includes(n.id))!;
    expect(added.data).toMatchObject({ name: 'New step', stepType: 'Agent' });
    expect(links(graph)).toEqual(
      [`a>${added.id}:source`, `${added.id}>b:source`, 'b>c:source'].sort()
    );
  });

  it('moves the target and everything after it right to make room', () => {
    const graph = chain();
    insert(graph);
    const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;
    const added = graph.nodes.find((n) => !['a', 'b', 'c'].includes(n.id))!;
    expect(x('a')).toBe(0);
    // The same distance for both: the chain keeps its shape.
    expect(x('b')).toBeGreaterThan(324);
    expect(x('c') - x('b')).toBe(648 - 324);
    expect(added.position.x).toBeGreaterThan(x('a'));
    expect(added.position.x).toBeLessThan(x('b'));
  });

  it('leaves nodes where they are when there is already room', () => {
    const graph: CanvasGraph = {
      nodes: [step('a', 0), step('b', 1200)],
      edges: [edge('a', 'b')],
    };
    insert(graph);
    expect(graph.nodes.find((n) => n.id === 'b')!.position.x).toBe(1200);
  });

  it('gives the step an id no other node has', () => {
    const graph = chain();
    graph.nodes.push(step('new_step', 2000));
    insert(graph);
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leads both branches of a Conditional on to the target', () => {
    const graph = chain();
    expect(insert(graph, 'Conditional', 'Check')).toBe(true);
    const added = graph.nodes.find((n) => !['a', 'b', 'c'].includes(n.id))!;
    expect(added.type).toBe(NODE_TYPES.ConditionalNode);
    expect(links(graph)).toEqual(
      [
        `a>${added.id}:source`,
        `${added.id}>b:true`,
        `${added.id}>b:false`,
        'b>c:source',
      ].sort()
    );
  });

  it('inserts nothing when an end of the edge is gone', () => {
    const graph = chain();
    const before = JSON.stringify(graph);
    expect(
      insertStepBetween(graph, {
        sourceNodeId: 'a',
        targetNodeId: 'missing',
        sourceHandle: 'source',
        newStepData: { name: 'New step', stepType: 'Agent' },
      })
    ).toBe(false);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps the step in the container its ends are in, and grows it', () => {
    const child = { parentId: 'split', extent: 'parent' as const };
    const graph: CanvasGraph = {
      nodes: [
        step('split', 0, {
          type: NODE_TYPES.ContainerNode,
          width: 600,
          height: 168,
          style: { width: 600, height: 168 },
        }),
        step('a', 24, child),
        step('b', 348, child),
      ],
      edges: [edge('a', 'b')],
    };
    insert(graph);
    const added = graph.nodes.find((n) => !['split', 'a', 'b'].includes(n.id))!;
    const container = graph.nodes.find((n) => n.id === 'split')!;
    const b = graph.nodes.find((n) => n.id === 'b')!;
    expect(added.parentId).toBe('split');
    expect(container.width).toBeGreaterThanOrEqual(
      b.position.x + (b.width ?? 0)
    );
    expect(container.style?.width).toBe(container.width);
  });
});

describe('expandParentToFitChildren', () => {
  const container = (width: number, height: number) =>
    step('split', 0, {
      type: NODE_TYPES.ContainerNode,
      width,
      height,
      style: { width, height },
    });

  it('grows a container to hold its children, with padding, on the grid', () => {
    const nodes = [
      container(204, 168),
      step('a', 24, { parentId: 'split' }),
      step('b', 480, { parentId: 'split' }),
    ];
    expandParentToFitChildren(nodes, 'split');
    // 480 + 216 wide, plus 48 of padding.
    expect(nodes[0].width).toBe(744);
    expect(nodes[0].style).toMatchObject({ width: 744, height: 168 });
    expect(nodes[0].width! % 12).toBe(0);
  });

  it('never shrinks a container larger than its children need', () => {
    const nodes = [container(1200, 600), step('a', 24, { parentId: 'split' })];
    expandParentToFitChildren(nodes, 'split');
    expect(nodes[0]).toMatchObject({ width: 1200, height: 600 });
  });

  it('counts only the children of that container', () => {
    const nodes = [
      container(204, 168),
      step('a', 24, { parentId: 'split' }),
      step('far', 5000, { parentId: 'other' }),
    ];
    expandParentToFitChildren(nodes, 'split');
    expect(nodes[0].width).toBe(288);
  });

  it('does nothing for a container that is not there', () => {
    const nodes = [step('a', 24, { parentId: 'gone' })];
    expect(() => expandParentToFitChildren(nodes, 'gone')).not.toThrow();
    expect(nodes).toHaveLength(1);
  });
});

describe('applyCanvasNodeChanges', () => {
  const handle = (side: 'left' | 'right') => ({
    isLeft: side === 'left',
    isRight: side === 'right',
    isTop: false,
    isBottom: false,
  });
  /** A container at the left, with two steps after it. */
  const canvas = (resizing?: 'left' | 'right'): ResizableCanvas => ({
    nodes: [
      step('split', 0, {
        type: NODE_TYPES.ContainerNode,
        width: 204,
        height: 168,
        style: { width: 204, height: 168 },
        data: {
          id: 'split',
          name: 'split',
          stepType: 'Split',
          ...(resizing ? { __resizeHandle: handle(resizing) } : {}),
        },
      }),
      step('b', 400),
      step('c', 800),
    ],
    edges: [edge('split', 'b'), edge('b', 'c')],
    resizeTracking: {},
  });
  const resize = (id: string, width: number, height = 168) =>
    ({
      type: 'dimensions',
      id,
      dimensions: { width, height },
      resizing: true,
    }) as const;
  const x = (c: ResizableCanvas, id: string) =>
    c.nodes.find((n) => n.id === id)!.position.x;
  const width = (c: ResizableCanvas, id: string) =>
    c.nodes.find((n) => n.id === id)!.width;

  it('snaps a moved step to the grid', () => {
    const c = canvas();
    const applied = applyCanvasNodeChanges(c, [
      { type: 'position', id: 'b', position: { x: 407, y: 5 } },
    ]);
    expect(c.nodes.find((n) => n.id === 'b')!.position).toEqual({
      x: 408,
      y: 0,
    });
    expect(applied).toHaveLength(1);
  });

  it('never resizes a step that is not a container', () => {
    const c = canvas();
    const applied = applyCanvasNodeChanges(c, [resize('b', 500)]);
    expect(applied).toEqual([]);
    expect(width(c, 'b')).toBe(216);
  });

  it('ignores a size React Flow reports for a container nobody is resizing', () => {
    const c = canvas();
    const applied = applyCanvasNodeChanges(c, [resize('split', 400)]);
    expect(applied).toEqual([]);
    expect(x(c, 'b')).toBe(400);
  });

  it('moves the steps after a container with its right edge, from where they began', () => {
    const c = canvas('right');
    applyCanvasNodeChanges(c, [resize('split', 300)]);
    expect(x(c, 'b')).toBe(400 + 96);
    expect(x(c, 'c')).toBe(800 + 96);
    // A second event of the same drag measures from the start, not from the
    // last event: the shift does not compound.
    applyCanvasNodeChanges(c, [resize('split', 348)]);
    expect(x(c, 'b')).toBe(400 + 144);
    expect(x(c, 'c')).toBe(800 + 144);
    expect(c.resizeTracking.split.originalWidth).toBe(204);
  });

  it('snaps a container being resized to the grid', () => {
    const c = canvas('right');
    const applied = applyCanvasNodeChanges(c, [resize('split', 305)]);
    expect(applied).toEqual([
      expect.objectContaining({
        type: 'dimensions',
        dimensions: { width: 300, height: 168 },
      }),
    ]);
  });

  it('leaves the steps after a container alone when its left edge is dragged', () => {
    const c = canvas('left');
    applyCanvasNodeChanges(c, [resize('split', 300)]);
    expect(x(c, 'b')).toBe(400);
    expect(x(c, 'c')).toBe(800);
  });

  it('takes no size from a batch that also moves a node: that is a drag', () => {
    const c = canvas('right');
    const applied = applyCanvasNodeChanges(c, [
      { type: 'position', id: 'b', position: { x: 420, y: 0 } },
      resize('split', 300),
    ]);
    expect(applied.map((change) => change.type)).toEqual(['position']);
    expect(x(c, 'c')).toBe(800);
    expect(c.resizeTracking).toEqual({});
  });

  it('forgets where a resize began once a batch carries no size', () => {
    const c = canvas('right');
    applyCanvasNodeChanges(c, [resize('split', 300)]);
    expect(Object.keys(c.resizeTracking)).toEqual(['split']);
    applyCanvasNodeChanges(c, [{ type: 'remove', id: 'c' }]);
    expect(c.resizeTracking).toEqual({});
    expect(c.nodes.map((n) => n.id)).toEqual(['split', 'b']);
  });
});

describe('workflowStore.onNodesChange', () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetState();
    useWorkflowStore.setState(chain());
  });

  it('counts a removed step as an edit of the structure', () => {
    useWorkflowStore.getState().onNodesChange([{ type: 'remove', id: 'c' }]);
    const state = useWorkflowStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(state.isDirty).toBe(true);
    expect(state.isStructurallyDirty).toBe(true);
  });

  it('counts a size it refused as no edit at all', () => {
    useWorkflowStore.getState().onNodesChange([
      {
        type: 'dimensions',
        id: 'b',
        dimensions: { width: 500, height: 60 },
        resizing: true,
      },
    ]);
    const state = useWorkflowStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.isStructurallyDirty).toBe(false);
  });

  it('counts a moved step as edited, but not structurally', () => {
    useWorkflowStore
      .getState()
      .onNodesChange([
        { type: 'position', id: 'b', position: { x: 360, y: 0 } },
      ]);
    const state = useWorkflowStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.isStructurallyDirty).toBe(false);
  });
});

describe('workflowStore.insertNodeBetween', () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetState();
    useWorkflowStore.setState(chain());
  });

  const insertInStore = (targetNodeId: string) =>
    useWorkflowStore
      .getState()
      .insertNodeBetween(
        'a',
        targetNodeId,
        'source',
        { name: 'New step', stepType: 'Agent' },
        { x: 0, y: 0 }
      );

  it('marks the workflow edited, structurally, when a step goes in', () => {
    insertInStore('b');
    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(4);
    expect(state.isDirty).toBe(true);
    expect(state.isStructurallyDirty).toBe(true);
    expect(state.dirtyRevision).toBe(1);
  });

  it('leaves the workflow clean when nothing could be inserted', () => {
    insertInStore('missing');
    const state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.isDirty).toBe(false);
    expect(state.isStructurallyDirty).toBe(false);
    expect(state.dirtyRevision).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { undoKey } from '@/features/workflows/components/WorkflowEditor/use-undo-keys';
import { useWorkflowStore } from './workflowStore';

const store = () => useWorkflowStore.getState();
const names = () =>
  store().nodes.map((node) => (node.data as { name?: string }).name);

const graph = {
  entryPoint: 'a',
  steps: {
    a: { id: 'a', stepType: 'Log', name: 'A', message: 'a', level: 'info' },
    b: { id: 'b', stepType: 'Log', name: 'B', message: 'b', level: 'info' },
  },
  executionPlan: [{ fromStep: 'a', toStep: 'b', label: 'next' }],
};

const rename = (id: string, name: string) =>
  store().editNodes((nodes) =>
    nodes.map((node) =>
      node.id === id ? { ...node, data: { ...node.data, name } } : node
    )
  );

/** Past the window in which edits count as one gesture. */
const later = () => vi.advanceTimersByTime(1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  store().resetState();
  store().setExecutionGraph(graph as never);
});
afterEach(() => vi.useRealTimers());

describe('undo and redo of canvas edits', () => {
  it('has nothing to undo on a workflow just loaded', () => {
    expect(store().past).toEqual([]);
    store().undo();
    store().redo();
    expect(names()).toEqual(['A', 'B']);
    expect(store().isDirty).toBe(false);
  });

  it('puts the canvas back as it was before the last edit, and makes the edit again', () => {
    rename('a', 'A1');
    later();
    rename('b', 'B1');
    expect(names()).toEqual(['A1', 'B1']);

    store().undo();
    expect(names()).toEqual(['A1', 'B']);
    store().undo();
    expect(names()).toEqual(['A', 'B']);
    expect(store().past).toEqual([]);

    store().redo();
    store().redo();
    expect(names()).toEqual(['A1', 'B1']);
    expect(store().future).toEqual([]);
  });

  it('brings back a removed step with its edges', () => {
    later();
    store().removeNode('b');
    expect(store().nodes.map((node) => node.id)).not.toContain('b');
    expect(store().edges).toHaveLength(0);

    store().undo();

    expect(store().nodes.map((node) => node.id)).toContain('b');
    expect(store().edges).toHaveLength(1);
  });

  it('counts an undo as a change to the workflow, since it is one to save', () => {
    rename('a', 'A1');
    store().clearDirtyFlag();
    const revision = store().dirtyRevision;

    store().undo();

    expect(store().isDirty).toBe(true);
    expect(store().dirtyRevision).toBe(revision + 1);
  });

  it('takes a drag as one step, however many moves it is made of', () => {
    const start = store().nodes.find((node) => node.id === 'a')!.position;
    for (let x = 1; x <= 20; x++) {
      store().onNodesChange([
        {
          id: 'a',
          type: 'position',
          position: { x: start.x + x * 10, y: start.y },
          dragging: true,
        },
      ]);
      vi.advanceTimersByTime(16);
    }
    expect(store().past).toHaveLength(1);

    store().undo();

    expect(store().nodes.find((node) => node.id === 'a')!.position).toEqual(
      start
    );
  });

  it('forgets what was undone once a new edit is made', () => {
    rename('a', 'A1');
    store().undo();
    expect(store().future).toHaveLength(1);

    // At once: an edit after an undo is a step of its own.
    rename('a', 'A2');

    expect(store().future).toEqual([]);
    store().undo();
    expect(names()).toEqual(['A', 'B']);
  });

  it('does not select a step that an undo took away', () => {
    later();
    const added = store().addNote({ x: 0, y: 0 }, 'note');
    store().setSelectedNodeId(added);

    store().undo();

    expect(store().selectedNodeId).toBeNull();
  });

  it('keeps the last fifty steps', () => {
    for (let i = 0; i < 60; i++) {
      rename('a', `A${i}`);
      later();
    }

    expect(store().past).toHaveLength(50);
  });

  it('starts a new history with a loaded graph', () => {
    rename('a', 'A1');
    store().undo();

    store().setExecutionGraph(graph as never);

    expect(store().past).toEqual([]);
    expect(store().future).toEqual([]);
  });
});

describe('undoKey', () => {
  const press = (key: string, modifiers: Record<string, boolean> = {}) =>
    undoKey({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

  it('reads the platform’s undo and redo', () => {
    expect(press('z', { metaKey: true })).toBe('undo');
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
  });

  it('reads nothing else', () => {
    expect(press('z')).toBeNull();
    expect(press('z', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('y', { metaKey: true })).toBeNull();
    expect(press('a', { ctrlKey: true })).toBeNull();
  });
});

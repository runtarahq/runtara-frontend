import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createStore } from 'zustand';
import { describe, expect, it } from 'vitest';

import { EditorStoresProvider } from './EditorStoresProvider';
import { editorStore } from './editor-scope';
import { useExecutionStore } from './executionStore';
import { useNodeFormStore } from './nodeFormStore';
import { useValidationStore } from './validationStore';
import { useWorkflowStore } from './workflowStore';

interface Counter {
  count: number;
  add: () => void;
}
let created = 0;
const useCounter = editorStore('test-counter', () => {
  created += 1;
  return createStore<Counter>()((set) => ({
    count: 0,
    add: () => set((state) => ({ count: state.count + 1 })),
  }));
});

function Count({ label }: { label: string }) {
  const count = useCounter((state) => state.count);
  return (
    <p>
      {label}: {count}
    </p>
  );
}

const editor = (key: string, label = key) => (
  <EditorStoresProvider key={key}>
    <Count label={label} />
  </EditorStoresProvider>
);

describe('editorStore', () => {
  it('works with no editor mounted, on one default set', () => {
    useCounter.setState({ count: 0 });
    useCounter.getState().add();
    render(<Count label="outside" />);

    expect(screen.getByText('outside: 1')).toBeInTheDocument();
    act(() => useCounter.getState().add());
    expect(screen.getByText('outside: 2')).toBeInTheDocument();
  });

  it('gives a mounted editor stores of its own, which code outside React reaches', () => {
    useCounter.setState({ count: 7 });
    const view = render(editor('a'));

    // Not the default set's 7.
    expect(screen.getByText('a: 0')).toBeInTheDocument();
    act(() => useCounter.getState().add());
    expect(screen.getByText('a: 1')).toBeInTheDocument();

    view.unmount();
    // Back on the default set, which the editor never touched.
    expect(useCounter.getState().count).toBe(7);
  });

  it('starts another workflow from new stores: there is nothing to reset', () => {
    const view = render(editor('workflow-1', 'editor'));
    act(() => useCounter.getState().add());
    act(() => useCounter.getState().add());
    expect(screen.getByText('editor: 2')).toBeInTheDocument();

    view.rerender(editor('workflow-2', 'editor'));

    expect(screen.getByText('editor: 0')).toBeInTheDocument();
    expect(useCounter.getState().count).toBe(0);
    view.unmount();
  });

  it('creates a store when an editor first needs it, once', () => {
    const before = created;
    const view = render(
      <EditorStoresProvider>
        <p>no store read</p>
      </EditorStoresProvider>
    );
    expect(created).toBe(before);

    act(() => {
      useCounter.getState();
      useCounter.getState();
    });
    expect(created).toBe(before + 1);
    view.unmount();
  });

  it('notifies subscribers of the mounted editor’s store', () => {
    const view = render(editor('a'));
    const seen: number[] = [];
    const unsubscribe = useCounter.subscribe((state) => seen.push(state.count));

    act(() => useCounter.getState().add());

    expect(seen).toEqual([1]);
    unsubscribe();
    view.unmount();
  });

  it('holds under StrictMode, where an editor mounts twice', () => {
    const view = render(<StrictMode>{editor('a')}</StrictMode>);

    act(() => useCounter.getState().add());

    expect(screen.getByText('a: 1')).toBeInTheDocument();
    view.unmount();
  });
});

describe('the editor’s stores', () => {
  it('are all the editor’s own: an editor opens on none of the last one’s state', () => {
    const view = render(
      <EditorStoresProvider key="one">
        <p>editor</p>
      </EditorStoresProvider>
    );
    act(() => {
      useWorkflowStore.setState({ isDirty: true, selectedNodeId: 'step' });
      useValidationStore.getState().setActiveTab('versions');
      useExecutionStore.setState({ executingInstanceId: 'run-1' });
      useNodeFormStore.setState({ ...useNodeFormStore.getState() });
    });
    const firstForm = useNodeFormStore.getState();

    view.rerender(
      <EditorStoresProvider key="two">
        <p>editor</p>
      </EditorStoresProvider>
    );

    expect(useWorkflowStore.getState().isDirty).toBe(false);
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
    expect(useValidationStore.getState().activeTab).not.toBe('versions');
    expect(useExecutionStore.getState().executingInstanceId).toBeNull();
    // The step form's store too, which no reset used to reach.
    expect(useNodeFormStore.getState()).not.toBe(firstForm);
    view.unmount();
  });
});

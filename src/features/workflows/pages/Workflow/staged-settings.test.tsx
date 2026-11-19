import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { EditorStoresProvider } from '@/features/workflows/stores/EditorStoresProvider';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useStagedSettings } from './staged-settings';

const staged = () => useStagedSettings.getState().staged;

beforeEach(() => useStagedSettings.getState().discard());

describe('useStagedSettings', () => {
  it('stages changes over the ones already staged', () => {
    useStagedSettings.getState().stage({ name: 'Orders' });
    useStagedSettings.getState().stage({ description: 'New', durable: false });
    useStagedSettings.getState().stage({ name: 'Orders v2' });

    expect(staged()).toEqual({
      name: 'Orders v2',
      description: 'New',
      durable: false,
    });
  });

  it('after a save, drops what the save sent and keeps what was edited meanwhile', () => {
    useStagedSettings.getState().stage({ name: 'Orders', description: 'Old' });
    const sent = staged();
    // Edited while the save was in flight (WF-2).
    useStagedSettings.getState().stage({ description: 'Newer' });

    useStagedSettings.getState().settle(sent);

    expect(staged()).toEqual({ description: 'Newer' });
  });

  it('takes an import’s settings in place of the staged ones', () => {
    useStagedSettings.getState().stage({ name: 'Orders' });

    useStagedSettings.getState().replace({ description: 'Imported' });

    expect(staged()).toEqual({ description: 'Imported' });
  });

  it('discards everything, and tells no one when there was nothing', () => {
    const before = useStagedSettings.getState();
    useStagedSettings.getState().discard();
    expect(useStagedSettings.getState()).toBe(before);

    useStagedSettings.getState().stage({ name: 'Orders' });
    useStagedSettings.getState().discard();
    expect(staged()).toEqual({});
  });

  it('belongs to the open workflow: another starts with nothing staged', () => {
    const editor = (key: string) => (
      <EditorStoresProvider key={key}>
        <p>editor</p>
      </EditorStoresProvider>
    );
    const view = render(editor('wf-1'));
    act(() => {
      useStagedSettings.getState().stage({ name: 'Unsaved' });
      useWorkflowStore.getState().markNodeStaged('step-1');
    });
    expect(staged()).toEqual({ name: 'Unsaved' });

    view.rerender(editor('wf-2'));

    expect(staged()).toEqual({});
    // And no step is marked as holding form edits (was a reset on mount).
    expect(useWorkflowStore.getState().stagedNodeIds.size).toBe(0);
    view.unmount();
  });
});

describe('markNodeStaged', () => {
  it('marks a step once', () => {
    useWorkflowStore.getState().resetState();
    useWorkflowStore.getState().markNodeStaged('a');
    const first = useWorkflowStore.getState().stagedNodeIds;
    useWorkflowStore.getState().markNodeStaged('a');

    expect(useWorkflowStore.getState().stagedNodeIds).toBe(first);
    expect([...first]).toEqual(['a']);
  });
});

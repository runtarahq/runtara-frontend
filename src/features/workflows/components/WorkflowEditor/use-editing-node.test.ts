import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEditingNode } from './use-editing-node';

function setup() {
  const hook = renderHook(() => useEditingNode());
  const now = () => hook.result.current;
  return { now };
}

describe('useEditingNode (ED-3)', () => {
  it('moves a clean editor to another step at once', () => {
    const { now } = setup();
    act(() => void now().editNode('first'));
    act(() => void now().editNode('second'));
    expect(now().editingNodeId).toBe('second');
    expect(now().switchTargetId).toBeNull();
  });

  it('holds a dirty editor on its step until the discard is confirmed', () => {
    const { now } = setup();
    act(() => void now().editNode('first'));
    act(() => now().setDirty(true));

    let opened = true;
    act(() => {
      opened = now().editNode('second');
    });
    expect(opened).toBe(false);
    expect(now().editingNodeId).toBe('first');
    expect(now().switchTargetId).toBe('second');

    act(() => now().confirmSwitch());
    expect(now().editingNodeId).toBe('second');
    expect(now().switchTargetId).toBeNull();
  });

  it('stays on the dirty step when the discard is declined', () => {
    const { now } = setup();
    act(() => void now().editNode('first'));
    act(() => now().setDirty(true));
    act(() => void now().editNode('second'));

    act(() => now().cancelSwitch());
    expect(now().editingNodeId).toBe('first');
    expect(now().switchTargetId).toBeNull();
  });

  it('does not prompt when re-opening the step already being edited', () => {
    const { now } = setup();
    act(() => void now().editNode('first'));
    act(() => now().setDirty(true));
    act(() => void now().editNode('first'));
    expect(now().switchTargetId).toBeNull();
  });

  it('treats a freshly opened editor as clean after a close', () => {
    const { now } = setup();
    act(() => void now().editNode('first'));
    act(() => now().setDirty(true));
    act(() => now().closeEditor());
    act(() => void now().editNode('second'));
    act(() => void now().editNode('first'));
    expect(now().editingNodeId).toBe('first');
    expect(now().switchTargetId).toBeNull();
  });
});

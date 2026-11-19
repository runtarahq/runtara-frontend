import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWarnBeforeUnload } from './useWarnBeforeUnload';

/** Whether leaving the page now would be questioned. */
const leavingIsQuestioned = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('useWarnBeforeUnload', () => {
  it('questions leaving the page while it is active, and not otherwise', () => {
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useWarnBeforeUnload(active),
      { initialProps: { active: false } }
    );
    expect(leavingIsQuestioned()).toBe(false);

    rerender({ active: true });
    expect(leavingIsQuestioned()).toBe(true);

    rerender({ active: false });
    expect(leavingIsQuestioned()).toBe(false);

    rerender({ active: true });
    unmount();
    expect(leavingIsQuestioned()).toBe(false);
  });
});

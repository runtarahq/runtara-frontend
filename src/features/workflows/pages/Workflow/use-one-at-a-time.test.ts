import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useOneAtATime } from './use-one-at-a-time';

describe('useOneAtATime (WF-3)', () => {
  it('drops a call made while one is running', async () => {
    let finish!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useOneAtATime(action));
    const run = result.current;

    const first = run();
    await run();
    expect(action).toHaveBeenCalledTimes(1);

    finish();
    await first;
    const second = run();
    finish();
    await second;
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('frees itself after a failure', async () => {
    const action = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useOneAtATime(action));
    await expect(result.current()).rejects.toThrow('boom');
    await result.current();
    expect(action).toHaveBeenCalledTimes(2);
  });
});

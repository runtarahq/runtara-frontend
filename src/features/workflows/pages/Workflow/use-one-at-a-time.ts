import { useCallback, useRef } from 'react';

/**
 * Wraps an async action so a call made while one is running is dropped, not
 * run alongside it. The workflow Save stays clickable through validation, so a
 * second click there used to send a second save (WF-3).
 */
export function useOneAtATime<A extends unknown[]>(
  action: (...args: A) => Promise<unknown>
): (...args: A) => Promise<void> {
  const actionRef = useRef(action);
  actionRef.current = action;
  const busyRef = useRef(false);
  return useCallback(async (...args: A) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await actionRef.current(...args);
    } finally {
      busyRef.current = false;
    }
  }, []);
}

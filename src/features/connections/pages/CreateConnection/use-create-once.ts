import { useCallback, useRef } from 'react';

/**
 * Lets the create page send its POST once (CN-9).
 *
 * `begin` claims the one create and says whether this submit may send it; a
 * second click, even one landing before the button disables, gets false.
 * `fail` gives the claim back after a POST that did not create anything, so
 * the user can retry. After a success it is never released: the connection
 * exists, and a second POST would orphan it behind a new one.
 */
export function useCreateOnce() {
  const claimedRef = useRef(false);
  const begin = useCallback(() => {
    if (claimedRef.current) return false;
    claimedRef.current = true;
    return true;
  }, []);
  const fail = useCallback(() => {
    claimedRef.current = false;
  }, []);
  return { begin, fail };
}

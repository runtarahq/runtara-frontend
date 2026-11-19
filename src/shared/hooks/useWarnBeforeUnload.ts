import { useEffect } from 'react';

/**
 * While `active`, asks the browser to confirm before the page is reloaded or
 * its tab closed, so unsaved work is not lost to a slip of the hand. The
 * browser words the question itself. Moving within the app is another
 * matter, for the navigation blocker.
 */
export function useWarnBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { PayloadSection } from './types';

/**
 * The full value of each section that has been asked for one: a section whose
 * value the server elided in part shows the whole once it is loaded.
 */
export function useFullValues(
  sections: PayloadSection[],
  loadFullValue?: (sectionId: string) => Promise<unknown>
) {
  // Each full value with the section value it was loaded for. A poll that
  // brings a new section value makes it stale: it used to stay on screen,
  // hiding every later update to that section (SH-6).
  const [loadedFull, setLoadedFull] = useState<
    Record<string, { for: unknown; value: unknown }>
  >({});
  const fullValues = useMemo(() => {
    const current: Record<string, unknown> = {};
    for (const section of sections) {
      const entry = loadedFull[section.id];
      if (entry && entry.for === section.value)
        current[section.id] = entry.value;
    }
    return current;
  }, [loadedFull, sections]);
  // Sections whose full value is loading. A set, so one load finishing does
  // not clear another section's indicator while that one is still going
  // (SH-7).
  const [loadingFull, setLoadingFull] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const valueOf = useCallback(
    (section: PayloadSection) =>
      section.id in fullValues ? fullValues[section.id] : section.value,
    [fullValues]
  );

  const ensureFull = async (section: PayloadSection): Promise<unknown> => {
    if (section.id in fullValues) return fullValues[section.id];
    if (!loadFullValue) return undefined;
    setLoadingFull((prev) => new Set(prev).add(section.id));
    try {
      const full = await loadFullValue(section.id);
      setLoadedFull((prev) => ({
        ...prev,
        [section.id]: { for: section.value, value: full },
      }));
      return full;
    } catch (error) {
      toast.error(
        `Could not load the full ${section.label.toLowerCase()}: ${
          error instanceof Error ? error.message : 'request failed'
        }`
      );
      return undefined;
    } finally {
      setLoadingFull((prev) => {
        const next = new Set(prev);
        next.delete(section.id);
        return next;
      });
    }
  };

  return { fullValues, loadingFull, valueOf, ensureFull };
}

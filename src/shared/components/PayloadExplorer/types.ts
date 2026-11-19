import type { ReactNode } from 'react';

import type { FieldLabel } from './PayloadTree';

export interface PayloadSection {
  id: string;
  label: string;
  /** The parsed JSON value. `null` or `undefined` shows the empty state. */
  value: unknown;
  emptyState?: { title: string; description?: string };
  /** Extra context shown above the tree, e.g. "Updated 3 hr ago". */
  meta?: ReactNode;
  /** Friendly labels for top-level keys, e.g. from a state schema. */
  fieldLabels?: Record<string, FieldLabel>;
}

export interface PayloadExplorerProps {
  sections: PayloadSection[];
  defaultSectionId?: string;
  /**
   * Fetches a section's full value when it contains server-elided
   * placeholders. Without it, placeholders show their size only.
   */
  loadFullValue?: (sectionId: string) => Promise<unknown>;
  /** Height of the scrolling area in pixels (420 by default, 240 compact). */
  maxHeight?: number;
  /**
   * Fits tight spaces (a step's details, a side panel): one toolbar row with
   * icon actions, and a path-only strip that appears once a field is selected.
   */
  compact?: boolean;
  ariaLabel?: string;
  className?: string;
}

export interface SectionView {
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  matchIndex: number;
}

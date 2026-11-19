import { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  SEARCH_MAX_NODES,
  formatCount,
  formatSize,
  plural,
  type PayloadSize,
  type SearchResult,
} from './model';

export function SectionNotes({
  compact,
  meta,
  size,
  search,
  canLoadFull,
  loadingFull,
  onLoadFull,
}: {
  compact: boolean;
  meta?: ReactNode;
  size: PayloadSize | null;
  search: SearchResult;
  canLoadFull: boolean;
  loadingFull: boolean;
  onLoadFull: () => void;
}) {
  const notes: ReactNode[] = [];
  if (meta) notes.push(<span key="meta">{meta}</span>);
  if (size?.elidedCount) {
    notes.push(
      <span key="elided" className="text-warning">
        {plural(size.elidedCount, 'large value')} not loaded (
        {formatSize(size.elidedBytes)})
        {canLoadFull && (
          <button
            type="button"
            onClick={onLoadFull}
            disabled={loadingFull}
            className="ml-1.5 font-medium text-primary-text hover:underline disabled:opacity-60"
          >
            {loadingFull ? 'Loading…' : 'Load full value'}
          </button>
        )}
      </span>
    );
  }
  if (size?.truncatedCount) {
    notes.push(
      <span key="truncated" className="text-warning">
        {plural(size.truncatedCount, 'value')} cut off by the server (
        {formatSize(size.truncatedBytes)} originally); only the stored part is
        shown.
      </span>
    );
  }
  if (search.stoppedAt === 'matches') {
    notes.push(
      <span key="cap">
        Showing the first {formatCount(search.matches.length)} matches. Refine
        the search to see others.
      </span>
    );
  } else if (search.stoppedAt === 'fields') {
    notes.push(
      <span key="cap">
        Searched the first {formatCount(SEARCH_MAX_NODES)} fields; matches
        further in are not listed.
      </span>
    );
  }
  if (!notes.length) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground',
        compact ? 'px-2 pt-1.5 text-[11px]' : 'px-4 pt-2 text-xs'
      )}
      aria-live="polite"
    >
      {notes}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 text-center',
        compact ? 'px-3 py-4' : 'px-6 py-10'
      )}
    >
      <p
        className={cn(
          'font-medium text-muted-foreground',
          compact ? 'text-xs' : 'text-sm'
        )}
      >
        {title}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export function IconButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Set for toggles; renders the pressed state. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded hover:bg-primary/10 hover:text-primary-text disabled:pointer-events-none disabled:opacity-40',
        pressed ? 'bg-primary/10 text-primary-text' : 'text-muted-foreground'
      )}
    >
      {children}
    </button>
  );
}

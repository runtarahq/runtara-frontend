import type { KeyboardEvent, RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { IconButton } from './ExplorerParts';
import { childCount, formatCount, isBranch, type SearchResult } from './model';
import { isEmptyValue } from './payload-cache';
import type { PayloadSection } from './types';

// The controls above the tree. The explorer lays them out twice, compact and
// full, so each is a component it places.

/** The sections as tabs, each with its field or match count; or the one's name. */
export function SectionPicker({
  sections,
  active,
  searches,
  valueOf,
  query,
  idPrefix,
  ariaLabel,
  compact,
  onSwitch,
  onKeyDown,
}: {
  sections: PayloadSection[];
  active: PayloadSection;
  searches: Record<string, SearchResult>;
  valueOf: (section: PayloadSection) => unknown;
  query: string;
  idPrefix: string;
  ariaLabel: string;
  compact: boolean;
  onSwitch: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return sections.length > 1 ? (
    <div
      role="tablist"
      aria-label={`${ariaLabel} sections`}
      className={cn(
        'flex flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5',
        compact && 'rounded-md'
      )}
    >
      {sections.map((section) => {
        const selected = section.id === active.id;
        const result = searches[section.id];
        const sectionValue = valueOf(section);
        const count = query
          ? `${formatCount(result.matches.length)}${result.stoppedAt === 'matches' ? '+' : ''}`
          : isEmptyValue(sectionValue)
            ? '—'
            : isBranch(sectionValue)
              ? formatCount(childCount(sectionValue))
              : '1';
        return (
          <button
            key={section.id}
            id={`${idPrefix}-tab-${section.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSwitch(section.id)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex items-center gap-1.5 font-medium transition-colors',
              compact
                ? 'rounded px-2 py-0.5 text-xs'
                : 'rounded-md px-3 py-1 text-sm',
              selected
                ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {section.label}
            <span
              className={cn(
                'text-[11px] tabular-nums',
                query && result.matches.length
                  ? 'rounded-full bg-warning/30 px-1.5 font-semibold text-foreground'
                  : 'text-muted-foreground'
              )}
              aria-label={
                query ? `${result.matches.length} matches` : undefined
              }
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <span
      id={`${idPrefix}-tab-${active.id}`}
      className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}
    >
      {active.label}
    </span>
  );
}

export function SearchBox({
  inputRef,
  input,
  onInput,
  onKeyDown,
  onClear,
  sectionLabels,
  compact,
}: {
  inputRef: RefObject<HTMLInputElement>;
  input: string;
  onInput: (input: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  sectionLabels: string[];
  compact: boolean;
}) {
  return (
    <label
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
        compact ? 'h-7 flex-[1_1_8rem] px-2' : 'h-8 flex-[1_1_16rem] px-2.5'
      )}
    >
      <Search
        className={cn(
          'shrink-0 text-muted-foreground',
          compact ? 'size-3.5' : 'size-4'
        )}
      />
      <input
        ref={inputRef}
        type="search"
        value={input}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          compact
            ? 'Search'
            : `Search keys and values${sectionLabels.length > 1 ? ` in ${sectionLabels.map((label) => label.toLowerCase()).join(', ')}` : ''}`
        }
        aria-label="Search keys and values"
        spellCheck={false}
        autoComplete="off"
        className={cn(
          'min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden',
          compact ? 'text-xs' : 'text-sm'
        )}
      />
      {input ? (
        <button
          type="button"
          aria-label="Clear search"
          className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        !compact && (
          <kbd className="rounded border border-b-2 px-1.5 font-mono text-[10px] text-muted-foreground">
            /
          </kbd>
        )
      )}
    </label>
  );
}

/** Where the selection is among the matches, and moving between them. */
export function MatchNav({
  matchCount,
  matchIndex,
  capped,
  onGo,
}: {
  matchCount: number;
  matchIndex: number;
  /** Whether the search stopped at its limit, so there may be more. */
  capped: boolean;
  onGo: (delta: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
      aria-live="polite"
    >
      <span className="px-1">
        {matchCount
          ? `${formatCount((matchIndex % matchCount) + 1)} of ${formatCount(matchCount)}${capped ? '+' : ''}`
          : 'No matches'}
      </span>
      <IconButton
        label="Previous match"
        disabled={matchCount < 2}
        onClick={() => onGo(-1)}
      >
        <ChevronUp className="size-3.5" />
      </IconButton>
      <IconButton
        label="Next match"
        disabled={matchCount < 2}
        onClick={() => onGo(1)}
      >
        <ChevronDown className="size-3.5" />
      </IconButton>
    </div>
  );
}

export type ExplorerMode = 'tree' | 'json';

export function ModeSwitch({
  mode,
  onMode,
  compact,
}: {
  mode: ExplorerMode;
  onMode: (mode: ExplorerMode) => void;
  compact: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex overflow-hidden rounded-md border"
    >
      {(['tree', 'json'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onMode(m)}
          className={cn(
            'font-medium',
            compact ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
            m === 'json' && 'border-l',
            mode === m
              ? 'bg-primary/10 text-primary-text'
              : 'bg-background text-muted-foreground hover:text-foreground'
          )}
        >
          {m === 'tree' ? 'Tree' : 'JSON'}
        </button>
      ))}
    </div>
  );
}

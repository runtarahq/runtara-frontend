import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ChevronsDownUp, ChevronsUpDown, Copy, ListFilter } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  hasElidedPayload,
  isTruncatedPayload,
} from '@/shared/utils/truncated-payload';
import {
  EXPAND_ALL_MAX_BRANCHES,
  ancestorIds,
  collectBranchIds,
  flattenRows,
  formatCount,
  formatPath,
  formatSize,
  getAt,
  groupValue,
  initialExpanded,
  kindOf,
  matchFilter,
  type PathSegment,
  type SearchResult,
  type TreeRow,
} from './model';
import { PayloadTree } from './PayloadTree';
import { PayloadRaw } from './PayloadRaw';
import { PayloadInspector } from './PayloadInspector';
import { EmptyState, IconButton, SectionNotes } from './ExplorerParts';
import {
  MatchNav,
  ModeSwitch,
  SearchBox,
  SectionPicker,
  type ExplorerMode,
} from './ExplorerToolbar';
import {
  cachedSearch,
  cachedSize,
  isEmptyValue,
  otherSectionsHint,
} from './payload-cache';
import type {
  PayloadExplorerProps,
  PayloadSection,
  SectionView,
} from './types';
import { useFullValues } from './use-full-values';

export type { PayloadExplorerProps, PayloadSection } from './types';

const SEARCH_DEBOUNCE_MS = 150;

async function writeClipboard(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Could not copy: the browser blocked clipboard access.');
  }
}

/**
 * Explores one or more JSON payloads (a run's input, output and state) as a
 * searchable, virtualized tree, with a raw JSON view, path copying and
 * graceful handling of very large or server-elided values.
 */
export function PayloadExplorer({
  sections,
  defaultSectionId,
  loadFullValue,
  maxHeight,
  compact = false,
  ariaLabel = 'Payload',
  className,
}: PayloadExplorerProps) {
  const idPrefix = `payload-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const searchRef = useRef<HTMLInputElement>(null);
  const treeWrapRef = useRef<HTMLDivElement>(null);

  const [activeId, setActiveId] = useState(
    () =>
      sections.find((s) => s.id === defaultSectionId)?.id ??
      sections[0]?.id ??
      ''
  );
  const active = sections.find((s) => s.id === activeId) ?? sections[0];
  const { fullValues, loadingFull, valueOf, ensureFull } = useFullValues(
    sections,
    loadFullValue
  );

  // Per-section folding, selection and match position. A section's first view
  // is created once and kept stable so memoized rows are not rebuilt.
  const defaultViews = useRef<Record<string, SectionView>>({});
  const [views, setViews] = useState<Record<string, SectionView>>({});
  const viewOf = (section: PayloadSection): SectionView => {
    const existing = views[section.id];
    if (existing) return existing;
    defaultViews.current[section.id] ??= {
      expanded: initialExpanded(valueOf(section)),
      selectedId: null,
      matchIndex: 0,
    };
    return defaultViews.current[section.id];
  };
  const updateView = (
    sectionId: string,
    update: (view: SectionView) => SectionView
  ) => {
    setViews((prev) => {
      const section = sections.find((s) => s.id === sectionId);
      const base = prev[sectionId] ?? (section ? viewOf(section) : null);
      return base ? { ...prev, [sectionId]: update(base) } : prev;
    });
  };

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [mode, setMode] = useState<ExplorerMode>('tree');

  const searches: Record<string, SearchResult> = {};
  for (const section of sections)
    searches[section.id] = cachedSearch(valueOf(section), query);

  // A new query opens the branches holding its matches in every section,
  // selects the first match, and moves to a section that has any.
  const revealedQuery = useRef('');
  useEffect(() => {
    if (query === revealedQuery.current) return;
    revealedQuery.current = query;
    if (!query) return;
    setViews((prev) => {
      const next = { ...prev };
      for (const section of sections) {
        const { matches } = cachedSearch(valueOf(section), query);
        if (!matches.length) continue;
        const base = prev[section.id] ?? viewOf(section);
        const expanded = new Set(base.expanded);
        const value = valueOf(section);
        for (const match of matches) {
          for (const id of ancestorIds(value, match.segments)) expanded.add(id);
        }
        next[section.id] = {
          expanded,
          matchIndex: 0,
          selectedId: matches[0].path,
        };
      }
      return next;
    });
    if (active && !cachedSearch(valueOf(active), query).matches.length) {
      const withMatches = sections.find(
        (s) => cachedSearch(valueOf(s), query).matches.length
      );
      if (withMatches) setActiveId(withMatches.id);
    }
    // Runs once per query; the ref guards against re-running on other changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const value = active ? valueOf(active) : undefined;
  const view = active ? viewOf(active) : null;
  const search = active ? searches[active.id] : null;
  const expanded = view?.expanded;
  const filter = useMemo(
    () =>
      onlyMatches && search?.query ? matchFilter(value, search.matches) : null,
    [onlyMatches, search, value]
  );
  const rows = useMemo(
    () => (expanded ? flattenRows(value, expanded, filter) : []),
    [value, expanded, filter]
  );
  const matchedPaths = useMemo(
    () => new Set(search?.matches.map((m) => m.path) ?? []),
    [search]
  );
  const selectedRow = useMemo(
    () =>
      view?.selectedId == null
        ? null
        : (rows.find((r) => r.id === view.selectedId) ?? null),
    [rows, view?.selectedId]
  );
  const size = active && !isEmptyValue(value) ? cachedSize(value) : null;
  const matchCount = search?.matches.length ?? 0;
  const currentMatch =
    view && matchCount ? search!.matches[view.matchIndex % matchCount] : null;

  // ---- Actions -------------------------------------------------------------

  const loadFull = async () => {
    if (!active) return;
    const full = await ensureFull(active);
    if (full !== undefined)
      toast.success(`Loaded the full ${active.label.toLowerCase()}`);
  };

  const rowValue = (row: TreeRow, root: unknown) => {
    const at = getAt(root, row.segments);
    return row.type === 'group' && row.range ? groupValue(at, row.range) : at;
  };

  const copyValue = async (row: TreeRow) => {
    if (!active) return;
    let copied = rowValue(row, value);
    if (hasElidedPayload(copied) && loadFullValue) {
      const full = await ensureFull(active);
      if (full !== undefined) copied = rowValue(row, full);
    }
    if (kindOf(copied) === 'truncated' && isTruncatedPayload(copied)) {
      // Only the stored beginning exists; say so rather than imply it is whole.
      await writeClipboard(
        copied._preview,
        'Copied the stored part of this value'
      );
      return;
    }
    await writeClipboard(
      typeof copied === 'string' ? copied : JSON.stringify(copied, null, 2),
      'Copied value'
    );
  };

  const copyPath = (row: TreeRow) => {
    void writeClipboard(row.path, `Copied ${row.path}`);
  };

  const copySection = async () => {
    if (!active) return;
    let copied = value;
    if (hasElidedPayload(copied) && loadFullValue) {
      const full = await ensureFull(active);
      if (full !== undefined) copied = full;
    }
    await writeClipboard(
      typeof copied === 'string' ? copied : JSON.stringify(copied, null, 2),
      `Copied ${active.label.toLowerCase()} JSON`
    );
  };

  const select = (id: string) => {
    if (active) updateView(active.id, (v) => ({ ...v, selectedId: id }));
  };

  const toggle = (row: TreeRow) => {
    if (!active) return;
    updateView(active.id, (v) => {
      const next = new Set(v.expanded);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return { ...v, expanded: next };
    });
  };

  const reveal = (segments: readonly PathSegment[]) => {
    if (!active) return;
    const path = formatPath(segments);
    updateView(active.id, (v) => {
      const next = new Set(v.expanded);
      for (const id of ancestorIds(value, segments)) next.add(id);
      return {
        ...v,
        expanded: next,
        selectedId: segments.length ? path : null,
      };
    });
  };

  const goToMatch = (delta: number) => {
    if (!active || !matchCount || !view) return;
    const index = (view.matchIndex + delta + matchCount) % matchCount;
    const match = search!.matches[index];
    updateView(active.id, (v) => {
      const next = new Set(v.expanded);
      for (const id of ancestorIds(value, match.segments)) next.add(id);
      return { expanded: next, matchIndex: index, selectedId: match.path };
    });
  };

  const expandAll = () => {
    if (!active) return;
    const { ids, truncated } = collectBranchIds(value);
    updateView(active.id, (v) => ({ ...v, expanded: new Set(ids) }));
    if (truncated) {
      toast.info(
        `Opened the first ${formatCount(EXPAND_ALL_MAX_BRANCHES)} branches. Search to reach the rest.`
      );
    }
  };

  const collapseAll = () => {
    if (active) updateView(active.id, (v) => ({ ...v, expanded: new Set() }));
  };

  const switchSection = (id: string) => {
    setActiveId(id);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = sections.findIndex((s) => s.id === active?.id);
    const next =
      sections[
        (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) %
          sections.length
      ];
    switchSection(next.id);
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const typed = input.trim();
      if (typed !== query) setQuery(typed);
      else goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && input) {
      event.preventDefault();
      setInput('');
      setQuery('');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      treeWrapRef.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
    }
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) &&
      !target.isContentEditable
    ) {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  if (!active || !view || !search) return null;

  const empty = isEmptyValue(value);
  const height = maxHeight ?? (compact ? 240 : 420);
  const canLoadFull = Boolean(loadFullValue) && !(active.id in fullValues);

  const sizeLabel = size && (
    <span
      className="tabular-nums text-muted-foreground"
      title="Approximate JSON size"
    >
      {size.complete ? '~' : '>'}
      {formatSize(size.bytes + size.elidedBytes + size.truncatedBytes)}
    </span>
  );

  const sectionPicker = (
    <SectionPicker
      sections={sections}
      active={active}
      searches={searches}
      valueOf={valueOf}
      query={query}
      idPrefix={idPrefix}
      ariaLabel={ariaLabel}
      compact={compact}
      onSwitch={switchSection}
      onKeyDown={onTabKeyDown}
    />
  );

  const searchBox = (
    <SearchBox
      inputRef={searchRef}
      input={input}
      onInput={setInput}
      onKeyDown={onSearchKeyDown}
      onClear={() => {
        setInput('');
        setQuery('');
        searchRef.current?.focus();
      }}
      sectionLabels={sections.map((section) => section.label)}
      compact={compact}
    />
  );

  const matchNav = query && (
    <MatchNav
      matchCount={matchCount}
      matchIndex={view.matchIndex}
      capped={search.stoppedAt === 'matches'}
      onGo={goToMatch}
    />
  );

  const modeSwitch = (
    <ModeSwitch mode={mode} onMode={setMode} compact={compact} />
  );

  const treeDisabled = mode !== 'tree' || empty;

  return (
    <section
      aria-label={ariaLabel}
      onKeyDown={onRootKeyDown}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border bg-card text-card-foreground',
        compact && 'rounded-md',
        className
      )}
    >
      {compact ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 px-2 py-1.5">
          {sectionPicker}
          {searchBox}
          {matchNav}
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="Only matches"
              pressed={onlyMatches}
              onClick={() => setOnlyMatches((on) => !on)}
            >
              <ListFilter className="size-3.5" />
            </IconButton>
            <IconButton
              label="Expand all"
              disabled={treeDisabled}
              onClick={expandAll}
            >
              <ChevronsUpDown className="size-3.5" />
            </IconButton>
            <IconButton
              label="Collapse all"
              disabled={treeDisabled}
              onClick={collapseAll}
            >
              <ChevronsDownUp className="size-3.5" />
            </IconButton>
            <IconButton
              label="Copy JSON"
              disabled={empty}
              onClick={() => void copySection()}
            >
              <Copy className="size-3.5" />
            </IconButton>
            <span className="ml-1">{modeSwitch}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Sections and size */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
            {sectionPicker}
            <div className="flex items-center gap-3 text-xs">
              {sizeLabel}
              <Button
                variant="secondary"
                bordered
                size="sm"
                onClick={() => void copySection()}
                disabled={empty}
              >
                <Copy className="size-3.5" />
                Copy JSON
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/30 px-4 py-2">
            {searchBox}
            {matchNav}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyMatches}
                  onChange={(event) => setOnlyMatches(event.target.checked)}
                  className="accent-primary"
                />
                Only matches
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={expandAll}
                disabled={treeDisabled}
              >
                Expand all
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={collapseAll}
                disabled={treeDisabled}
              >
                Collapse all
              </Button>
              {modeSwitch}
            </div>
          </div>
        </>
      )}

      {/* Context */}
      <SectionNotes
        compact={compact}
        meta={active.meta}
        size={size}
        search={search}
        canLoadFull={canLoadFull}
        loadingFull={loadingFull.has(active.id)}
        onLoadFull={() => void loadFull()}
      />

      {/* Content */}
      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${active.id}`}
        ref={treeWrapRef}
      >
        {empty ? (
          <EmptyState
            compact={compact}
            title={
              active.emptyState?.title ?? `No ${active.label.toLowerCase()}`
            }
            description={active.emptyState?.description}
          />
        ) : mode === 'json' ? (
          <PayloadRaw
            value={value}
            query={query}
            maxHeight={height}
            label={active.label}
          />
        ) : rows.length === 0 ? (
          query && onlyMatches ? (
            <EmptyState
              compact={compact}
              title={`No matches in ${active.label.toLowerCase()}`}
              description={otherSectionsHint(sections, searches, active.id)}
            />
          ) : (
            <EmptyState
              compact={compact}
              title={Array.isArray(value) ? 'Empty array' : 'Empty object'}
            />
          )
        ) : (
          <PayloadTree
            rows={rows}
            idPrefix={`${idPrefix}-row`}
            ariaLabel={`${active.label} fields`}
            maxHeight={height}
            selectedId={view.selectedId}
            query={query}
            matchedPaths={matchedPaths}
            currentMatchPath={currentMatch?.path ?? null}
            fieldLabels={active.fieldLabels}
            canLoadFull={canLoadFull}
            loadingFull={loadingFull.has(active.id)}
            onSelect={select}
            onToggle={toggle}
            onCopyPath={copyPath}
            onCopyValue={(row) => void copyValue(row)}
            onLoadFull={() => void loadFull()}
          />
        )}
      </div>

      {/* Inspector */}
      {!empty && mode === 'tree' && (!compact || selectedRow) && (
        <div
          role="group"
          aria-label="Selected field"
          className={cn('border-t', compact ? 'px-2 py-1.5' : 'px-4 py-2.5')}
        >
          <PayloadInspector
            compact={compact}
            row={selectedRow}
            sectionLabel={active.label}
            onSelectPath={reveal}
            onCopyPath={copyPath}
            onCopyValue={(row) => void copyValue(row)}
          />
        </div>
      )}
    </section>
  );
}

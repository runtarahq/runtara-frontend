import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  SlidersHorizontal,
} from 'lucide-react';

import type { OperationViewConfig } from '@/generated/RuntaraRuntimeApi';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { WithTooltip } from '@/shared/components/ui/tooltip';
import type { StateField } from '@/features/runs/components/StateValue';
import { stateLabel } from '@/features/runs/utils/state-label';

export type QueueTab = 'open' | 'overdue';

/**
 * The row above a queue's table: its tabs (or, for a view of runs, their
 * count and sort), the search, and the filters toggle.
 */
export function QueueToolbar({
  isQueue,
  tabs,
  activeTab,
  onTab,
  total,
  search,
  onSearch,
  filtersOpen,
  filterCount,
  onToggleFilters,
  sort,
  onSort,
  schema,
}: {
  isQueue: boolean;
  tabs: { key: QueueTab; label: string; count?: number }[];
  activeTab: QueueTab;
  onTab: (tab: QueueTab) => void;
  total?: number;
  search: string;
  onSearch: (search: string) => void;
  filtersOpen: boolean;
  filterCount: number;
  onToggleFilters: () => void;
  sort: OperationViewConfig['sort'];
  onSort: (sort: NonNullable<OperationViewConfig['sort']> | null) => void;
  schema: Record<string, StateField>;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {isQueue ? (
        <div
          role="tablist"
          aria-label="Requests"
          className="mr-auto flex items-center gap-1 rounded-lg bg-muted p-1 text-sm"
        >
          {tabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'rounded-md px-3 py-1 font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => onTab(t.key)}
              >
                {t.label}
                <span
                  className={cn(
                    'ml-1.5 tabular-nums',
                    t.key === 'overdue' && t.count
                      ? 'text-warning'
                      : 'text-muted-foreground'
                  )}
                >
                  {t.count?.toLocaleString() ?? '…'}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mr-auto text-sm font-medium tabular-nums">
          {total?.toLocaleString() ?? '…'}{' '}
          <span className="font-normal text-muted-foreground">
            {total === 1 ? 'run' : 'runs'}
          </span>
        </p>
      )}
      <Input
        aria-label="Search runs"
        placeholder="Search label or run"
        className="w-full sm:w-64"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <Button
        variant="secondary"
        aria-expanded={filtersOpen}
        onClick={onToggleFilters}
      >
        <SlidersHorizontal />
        Filters
        {filterCount ? ` (${filterCount})` : ''}
      </Button>
      {isQueue ? null : (
        <div className="flex items-center gap-1">
          <select
            aria-label="Sort by"
            className="h-8 max-w-full rounded-md border bg-background px-2 text-sm"
            value={sort?.field ?? ''}
            onChange={(e) =>
              onSort(
                e.target.value
                  ? { field: e.target.value, descending: false }
                  : null
              )
            }
          >
            <option value="">Recent runs first</option>
            {Object.keys(schema).map((field) => (
              <option key={field} value={field}>
                Sort by {stateLabel(field, schema[field])}
              </option>
            ))}
          </select>
          {sort ? (
            <WithTooltip
              label={
                sort.descending
                  ? 'Descending — switch to ascending'
                  : 'Ascending — switch to descending'
              }
            >
              <Button
                variant="secondary"
                bordered
                size="icon"
                aria-label={
                  sort.descending ? 'Sort descending' : 'Sort ascending'
                }
                // A direction toggle, as its tooltip says; clearing the
                // sort is the select's "Recent runs first" (OP-7).
                onClick={() =>
                  onSort({ ...sort, descending: !sort.descending })
                }
              >
                {sort.descending ? (
                  <ArrowDownWideNarrow />
                ) : (
                  <ArrowUpNarrowWide />
                )}
              </Button>
            </WithTooltip>
          ) : null}
        </div>
      )}
    </div>
  );
}

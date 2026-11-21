import { cn } from '@/lib/utils';

export type RequestTab = 'open' | 'overdue';

/**
 * Open and Overdue, with their counts: the same strip on every request list,
 * drawn as the Runs page draws its status filters.
 */
export function RequestTabs({
  active,
  open,
  overdue,
  onChange,
  className,
}: {
  active: RequestTab;
  open?: number;
  /** Left out when no queue in the list tracks a due time. */
  overdue?: number | null;
  onChange: (tab: RequestTab) => void;
  className?: string;
}) {
  const tabs = [
    { key: 'open' as const, label: 'Open', count: open },
    ...(overdue === null
      ? []
      : [{ key: 'overdue' as const, label: 'Overdue', count: overdue }]),
  ];
  return (
    <div
      role="tablist"
      aria-label="Requests"
      className={cn('flex flex-wrap items-center gap-x-6 gap-y-1', className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={cn(
            '-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium',
            active === tab.key
              ? 'border-primary font-semibold text-primary-text'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          <span
            className={cn(
              'rounded-full px-[7px] py-px text-[11.5px] font-semibold tabular-nums',
              tab.key === 'overdue' && tab.count
                ? 'bg-warning/15 text-warning-text'
                : active === tab.key
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
            )}
          >
            {tab.count?.toLocaleString() ?? '—'}
          </span>
        </button>
      ))}
    </div>
  );
}

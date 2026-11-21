import { cn } from '@/lib/utils';

export type RequestTab = 'open' | 'overdue';

/** Open and Overdue, with their counts: the same control on every request list. */
export function RequestTabs({
  active,
  open,
  overdue,
  onChange,
}: {
  active: RequestTab;
  open?: number;
  /** Left out when no queue in the list tracks a due time. */
  overdue?: number | null;
  onChange: (tab: RequestTab) => void;
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
      className="flex items-center gap-1 rounded-lg bg-muted p-1 text-sm"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={cn(
            'rounded-md px-3 py-1 font-medium transition-colors',
            active === tab.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          <span
            className={cn(
              'ml-1.5 tabular-nums',
              tab.key === 'overdue' && tab.count
                ? 'text-warning'
                : 'text-muted-foreground'
            )}
          >
            {tab.count?.toLocaleString() ?? '…'}
          </span>
        </button>
      ))}
    </div>
  );
}

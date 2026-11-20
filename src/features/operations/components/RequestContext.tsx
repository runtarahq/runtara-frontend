import { contextEntries, contextText } from '../request-context';

/**
 * What a request is about, as its workflow said on the wait step
 * (`action.context`): shown above the answer, so whoever decides sees what
 * they decide on (a tool a builder proposes, an order to approve).
 */
export function RequestContext({ context }: { context: unknown }) {
  const entries = contextEntries(context);
  if (!entries.length) return null;
  return (
    <dl
      aria-label="Request details"
      className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm"
    >
      {entries.map(({ key, label, value }) => {
        const text = contextText(value);
        const structured = typeof value === 'object';
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">
              {structured ? (
                <code className="whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(value, null, 2)}
                </code>
              ) : (
                text
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

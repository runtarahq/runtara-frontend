import { stateEntries, type AttentionRequest } from '../attention-requests';
import { contextEntries, contextText } from '../request-context';
import { StateValue } from './StateValue';

/**
 * What a request asks and what it is about, in a list row: the question, then
 * the values its workflow put on the request and the run's state fields its
 * queue shows. Enough to decide in the row; the panel has all of it.
 */
export function RequestDetails({
  request,
  limit = 6,
}: {
  request: AttentionRequest;
  limit?: number;
}) {
  const { row, view, stateSchema } = request;
  const context = contextEntries(row.context).filter(
    ({ value }) => typeof value !== 'object' && contextText(value).length <= 80
  );
  // The title and the Due column already show these two.
  const state = stateEntries(request, [
    ...context.map((entry) => entry.key),
    view.roles?.key,
    view.roles?.due,
  ]);
  const entries = [...context, ...state];
  const shown = entries.slice(0, limit);
  return (
    <div className="min-w-0 space-y-1">
      <p className="truncate text-sm" title={row.label}>
        {row.label}
      </p>
      {row.message && row.message !== row.label ? (
        <p
          className="truncate text-[12.5px] text-muted-foreground"
          title={row.message}
        >
          {row.message}
        </p>
      ) : null}
      {shown.length ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px]">
          {shown.map(({ key, label, value }) => (
            <div key={key} className="flex min-w-0 max-w-full gap-1.5">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-medium">
                <StateValue
                  value={value}
                  field={stateSchema[key]}
                  display={view.formats?.[key] ?? undefined}
                />
              </dd>
            </div>
          ))}
          {entries.length > shown.length ? (
            <div className="text-muted-foreground">
              +{entries.length - shown.length} more
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

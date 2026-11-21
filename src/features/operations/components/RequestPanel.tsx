import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { Can } from '@/shared/components/Can';
import { Button } from '@/shared/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/shared/components/ui/sheet';
import { ActionForm } from '@/features/workflows/components/ActionForm';
import { useManagedInputSubmissions } from '@/features/workflows/hooks/useManagedInputSubmissions';
import {
  contextKeys,
  requestTitle,
  stateEntries,
  type AttentionRequest,
} from '../attention-requests';
import { StateValue } from './StateValue';
import { contextEntries } from '../request-context';
import { withFieldLabels } from '../answer-options';

/** When a request is due, or when it expires unanswered; nothing when neither is set. */
export function RequestTiming({
  request,
  plain = false,
}: {
  request: AttentionRequest;
  /** Leave the colour to the surrounding element. */
  plain?: boolean;
}) {
  const { due, isOverdue, row } = request;
  if (due)
    return (
      <span
        className={isOverdue && !plain ? 'font-medium text-warning' : undefined}
      >
        {isOverdue
          ? `Overdue ${formatDistanceToNowStrict(new Date(due))}`
          : `Due in ${formatDistanceToNowStrict(new Date(due))}`}
      </span>
    );
  if (row.deadline)
    return (
      <span title="The request closes unanswered at this time">
        Expires in {formatDistanceToNowStrict(new Date(row.deadline))}
      </span>
    );
  return (
    <span className="text-muted-foreground" aria-label="No due time">
      —
    </span>
  );
}

/**
 * One request beside its list: what it is about and its answer form, with
 * Previous and Next so a list is worked through without leaving it.
 */
export function RequestPanel({
  request,
  position,
  onStep,
  onClose,
}: {
  request?: AttentionRequest;
  /** Where the request is in the list, zero-based, and how long the list is. */
  position?: { index: number; count: number };
  onStep: (offset: 1 | -1) => void;
  onClose: () => void;
}) {
  const submissions = useManagedInputSubmissions();
  const row = request?.row;
  const retained =
    row &&
    [...submissions.inputs]
      .reverse()
      .find(
        (input) =>
          input.request.instanceId === row.instanceId &&
          input.request.requestId === row.requestId
      );
  return (
    <Sheet open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        // The list stays readable behind the panel: it is what Previous and
        // Next walk through.
        overlayClassName="bg-foreground/10 backdrop-blur-none"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {request && row ? (
          <>
            <header className="space-y-2 border-b px-6 pb-4 pr-12 pt-5">
              <SheetTitle className="truncate text-lg">
                {requestTitle(request)}
              </SheetTitle>
              <SheetDescription className="truncate text-[13px]">
                {request.queueName} · {request.workflowName}
              </SheetDescription>
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  Waiting {formatDistanceToNowStrict(new Date(row.requestedAt))}
                </span>
                {request.due || row.deadline ? (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5',
                      request.isOverdue
                        ? 'bg-warning/15 text-warning-text'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <RequestTiming request={request} plain />
                  </span>
                ) : null}
              </p>
            </header>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <RequestFacts request={request} />
              <section aria-label="Answer" className="space-y-3">
                <SectionLabel>Answer</SectionLabel>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{row.label}</h3>
                  {row.message && row.message !== row.label ? (
                    <p className="text-sm text-muted-foreground">
                      {row.message}
                    </p>
                  ) : null}
                </div>
                <Can
                  permission="workflow:execute"
                  fallback={
                    <p className="text-sm text-muted-foreground">
                      You can read this request but not answer it.
                    </p>
                  }
                >
                  {retained ? (
                    <p role="status" className="text-sm">
                      {retained.state === 'accepted'
                        ? 'Answered'
                        : retained.state === 'submitting'
                          ? 'Sending…'
                          : (retained.error ??
                            'Not confirmed. Retry from the list.')}
                    </p>
                  ) : (
                    <div className="max-w-xs">
                      <ActionForm
                        key={`${row.instanceId}/${row.requestId}`}
                        submitLabel="Send answer"
                        submitClassName="px-4"
                        inputSchema={withFieldLabels(row.inputSchema)}
                        onSubmit={(payload) =>
                          void submissions.submit(
                            {
                              kind: 'execution',
                              workflowId: row.workflowId,
                              instanceId: row.instanceId,
                              requestId: row.requestId,
                              payload,
                            },
                            row.runLabel ?? row.label
                          )
                        }
                      />
                    </div>
                  )}
                </Can>
              </section>
            </div>
            <footer className="flex h-12 shrink-0 items-center gap-2 border-t bg-table-head px-6 text-[13px] text-muted-foreground">
              <Button
                variant="secondary"
                bordered
                size="icon-sm"
                aria-label="Previous request"
                disabled={!position || position.index <= 0}
                onClick={() => onStep(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="secondary"
                bordered
                size="icon-sm"
                aria-label="Next request"
                disabled={!position || position.index >= position.count - 1}
                onClick={() => onStep(1)}
              >
                <ChevronRight />
              </Button>
              {position ? (
                <span className="tabular-nums">
                  {position.index + 1} of {position.count}
                </span>
              ) : null}
              <Link
                className="ml-auto font-medium text-primary-text hover:underline"
                to={`/operations/runs/${row.workflowId}/${row.instanceId}`}
              >
                Open run
              </Link>
            </footer>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * What the request is about, as one list: the values its workflow put on it,
 * then the run's state fields its queue shows.
 */
function RequestFacts({ request }: { request: AttentionRequest }) {
  const { row, view, stateSchema } = request;
  const entries = [
    ...contextEntries(row.context),
    ...stateEntries(request, contextKeys(row.context)),
  ];
  if (!entries.length) return null;
  return (
    <section aria-label="Request details" className="space-y-2">
      <SectionLabel>Details</SectionLabel>
      <dl className="divide-y divide-border/60 text-sm">
        {entries.map(({ key, label, value }) => (
          <div
            key={key}
            className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 py-2"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-medium">
              {value !== null && typeof value === 'object' ? (
                <code className="whitespace-pre-wrap break-all text-xs font-normal">
                  {JSON.stringify(value, null, 2)}
                </code>
              ) : (
                <StateValue
                  value={value}
                  field={stateSchema[key]}
                  display={view.formats?.[key] ?? undefined}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

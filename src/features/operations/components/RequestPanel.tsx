import { Link } from 'react-router';
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
import { RequestContext } from './RequestContext';

/** When a request is due, or when it expires unanswered; nothing when neither is set. */
export function RequestTiming({ request }: { request: AttentionRequest }) {
  const { due, isOverdue, row } = request;
  if (due)
    return (
      <span className={isOverdue ? 'font-medium text-warning' : undefined}>
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
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        {request && row ? (
          <>
            <div className="space-y-1 pr-6">
              <SheetTitle>{requestTitle(request)}</SheetTitle>
              <SheetDescription>
                {request.queueName} · {request.workflowName}
              </SheetDescription>
              <p className="text-xs text-muted-foreground">
                Waiting {formatDistanceToNowStrict(new Date(row.requestedAt))} ·{' '}
                <RequestTiming request={request} />
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{row.label}</h3>
              {row.message && row.message !== row.label ? (
                <p className="text-sm">{row.message}</p>
              ) : null}
            </div>
            <RequestContext context={row.context} />
            <RunState request={request} />
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
                <ActionForm
                  key={`${row.instanceId}/${row.requestId}`}
                  submitLabel="Send answer"
                  inputSchema={row.inputSchema}
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
              )}
            </Can>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  bordered
                  disabled={!position || position.index <= 0}
                  onClick={() => onStep(-1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  bordered
                  disabled={!position || position.index >= position.count - 1}
                  onClick={() => onStep(1)}
                >
                  Next
                </Button>
                {position ? (
                  <span className="self-center text-xs tabular-nums text-muted-foreground">
                    {position.index + 1} of {position.count}
                  </span>
                ) : null}
              </div>
              <Link
                className="text-primary-text hover:underline"
                to={`/operations/runs/${row.workflowId}/${row.instanceId}`}
              >
                Open run
              </Link>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The run's state the queue shows, beside what the request itself carries. */
function RunState({ request }: { request: AttentionRequest }) {
  const entries = stateEntries(request, contextKeys(request.row.context));
  if (!entries.length) return null;
  return (
    <dl
      aria-label="Run state"
      className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-md border p-3 text-sm"
    >
      {entries.map(({ key, label, value }) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">
            <StateValue
              value={value}
              field={request.stateSchema[key]}
              display={request.view.formats?.[key] ?? undefined}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

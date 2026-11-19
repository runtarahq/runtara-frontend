import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Clock3, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import { WithTooltip } from '@/shared/components/ui/tooltip';
import { Can } from '@/shared/components/Can';
import { queryKeys } from '@/shared/queries/query-keys';
import { WorkflowInstanceDto } from '@/generated/RuntaraRuntimeApi';
import { StateValue } from '@/features/runs/components/StateValue';
import { message, operationsRequest } from '@/features/runs/queries';

// What a list of runs offers beside the runs themselves: refreshing it, and
// replaying one. Shared by the operations pages and the run history.

export function RefreshControls({
  updatedAt,
  busy,
  onRefresh,
  compact = false,
}: {
  updatedAt?: number;
  busy?: boolean;
  onRefresh: () => void;
  /** Icon only; the last update moves into the tooltip. */
  compact?: boolean;
}) {
  if (compact)
    return (
      <WithTooltip
        label={
          updatedAt ? (
            <>
              Refresh · updated{' '}
              <StateValue
                value={new Date(updatedAt).toISOString()}
                display={{ kind: 'relative' }}
              />
            </>
          ) : (
            'Refresh'
          )
        }
      >
        <Button
          variant="secondary"
          size="icon"
          aria-label="Refresh"
          disabled={busy}
          onClick={onRefresh}
        >
          <RefreshCw className={busy ? 'animate-spin' : ''} />
        </Button>
      </WithTooltip>
    );
  return (
    <>
      {updatedAt ? (
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <Clock3 className="size-3.5" />
          Updated{' '}
          <StateValue
            value={new Date(updatedAt).toISOString()}
            display={{ kind: 'relative' }}
          />
        </span>
      ) : null}
      <Button variant="secondary" bordered disabled={busy} onClick={onRefresh}>
        <RefreshCw className={busy ? 'animate-spin' : ''} />
        Refresh
      </Button>
    </>
  );
}
export function ReplayButton({
  run,
  initiallyConfirm = false,
  onClose,
}: {
  run: Pick<WorkflowInstanceDto, 'id' | 'workflowId' | 'runLabel'>;
  initiallyConfirm?: boolean;
  onClose?: () => void;
}) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(initiallyConfirm);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // Closed while the request ran: the user has moved on, so the answer must
  // not navigate them away from where they are now (OP-10).
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );
  async function replay() {
    setBusy(true);
    try {
      const result = await operationsRequest<{ instanceId: string }>(
        `workflows/instances/${run.id}/replay`,
        'POST',
        {}
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.operations.all }),
        client.invalidateQueries({ queryKey: queryKeys.executions.lists() }),
      ]);
      toast.success(`Replay queued for ${run.runLabel ?? 'run'}`);
      if (!mountedRef.current) return;
      onClose?.();
      if (result.instanceId)
        navigate(`/operations/runs/${run.workflowId}/${result.instanceId}`);
      setConfirm(false);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Can permission="workflow:execute">
      {confirm ? (
        <div className="max-w-sm space-y-2 text-sm">
          <p>
            Replay starts from the beginning and repeats all side effects. The
            label stays the same.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void replay()}>
              {busy ? 'Queueing…' : 'Confirm Replay'}
            </Button>
            <Button
              variant="secondary"
              bordered
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                onClose?.();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setConfirm(true)}>
          <RefreshCw />
          Replay
        </Button>
      )}
    </Can>
  );
}

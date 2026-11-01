import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';

import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import type { PendingConfirmation } from '@/features/connections/queries';

/** Who started a flow, from its `channel:id` label. */
export function describeStarter(startedBy: string): string {
  const [channel, ...rest] = startedBy.split(':');
  const who = rest.join(':');
  switch (channel) {
    case 'api_key':
      return `an API key of ${who}`;
    case 'mcp':
      return `an MCP client of ${who}`;
    case 'member':
      return who;
    default:
      return startedBy || 'someone';
  }
}

/**
 * A connection authorized by a flow started without a browser (an API client
 * or an MCP tool handing someone a link) waits here, unusable, until a member
 * confirms that the provider account is the right one. Confirming or
 * rejecting names the authorization shown, so a later one is never confirmed
 * unseen.
 */
export function PendingConfirmationNotice({
  provider,
  pending,
  deciding,
  onDecide,
}: {
  provider: string;
  pending: PendingConfirmation;
  deciding: 'confirm' | 'reject' | null;
  onDecide: (decision: 'confirm' | 'reject') => void;
}) {
  const [now] = useState(() => Date.now());
  const until = new Date(pending.pendingUntil);
  const expired = !Number.isNaN(until.getTime()) && until.getTime() <= now;
  const account = pending.account?.display || pending.account?.id;
  return (
    <div
      className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-foreground"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">Waiting for your confirmation</p>
            <p className="text-sm">
              {account ? (
                <>
                  The {provider} account <strong>{account}</strong> was
                  connected
                </>
              ) : (
                <>
                  A {provider} account was connected ({provider} does not say
                  which)
                </>
              )}{' '}
              through a link started by {describeStarter(pending.startedBy)}.
              Workflows cannot use it until a member confirms it is the right
              one.{' '}
              {expired
                ? 'The time to confirm it is over.'
                : `Confirm it within ${formatDistanceToNowStrict(until)}, or it is dropped.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onDecide('confirm')}
              disabled={deciding !== null || expired}
            >
              {deciding === 'confirm' && <Spinner className="mr-1.5 size-4" />}
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onDecide('reject')}
              disabled={deciding !== null}
            >
              {deciding === 'reject' && <Spinner className="mr-1.5 size-4" />}
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

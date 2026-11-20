import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { appBaseUrl } from '@/shared/config/appBase';
import { useToken } from '@/shared/hooks/useToken';
import { getRuntimeBaseUrl } from '@/shared/queries/utils';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Spinner } from '@/shared/components/ui/spinner';
import { issueToken } from '@/features/workflows/queries/conversations';
import {
  orgOfRuntimeBase,
  sharedChatLink,
} from '@/features/workflows/utils/shared-chat-link';

/** How long a link may last. A day is the most the server gives. */
const LIFETIMES = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 8 * 3600, label: '8 hours' },
  { seconds: 24 * 3600, label: '1 day' },
] as const;

interface ShareConversationDialogProps {
  workflowId: string;
  conversationKey: string;
  onClose: () => void;
}

/**
 * Makes a link to one conversation for someone who is not a member. The
 * link holds a token for this conversation alone, shown once: whoever has
 * it can read the conversation and talk in it until it expires.
 */
export function ShareConversationDialog({
  workflowId,
  conversationKey,
  onClose,
}: ShareConversationDialogProps) {
  const token = useToken();
  const [seconds, setSeconds] = useState<number>(LIFETIMES[0].seconds);
  const [copied, setCopied] = useState(false);

  const issue = useMutation({
    mutationFn: async () => {
      // Every message sent with the link is from this sender, which the
      // page that holds it cannot change: it is told apart from the
      // workspace's own.
      const sender = `link:${crypto.randomUUID()}`;
      const issued = await issueToken(token, workflowId, conversationKey, {
        ttlSeconds: seconds,
        sender: { id: sender, name: 'Guest' },
      });
      return {
        expiresAt: issued.expiresAt,
        link: sharedChatLink(appBaseUrl, {
          workflowId,
          key: conversationKey,
          token: issued.token,
          org: orgOfRuntimeBase(getRuntimeBaseUrl()),
          sender,
          expiresAt: issued.expiresAt,
        }),
      };
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'The link could not be made'
      ),
  });
  const made = issue.data;

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.link);
      setCopied(true);
    } catch {
      toast.error('Could not copy the link. Select it and copy it.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this conversation</DialogTitle>
          <DialogDescription>
            Anyone with the link can read this conversation and send messages in
            it, without an account. They see nothing else of the workspace.
          </DialogDescription>
        </DialogHeader>

        {made ? (
          <div className="my-4 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Link"
                value={made.link}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Copy the link"
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              It works until {formatDate(made.expiresAt)}, and cannot be
              withdrawn before then. It is shown only now: copy it before you
              close this.
            </p>
          </div>
        ) : (
          <label className="my-4 block text-sm">
            The link works for
            <select
              aria-label="The link works for"
              className="mt-1 block h-9 w-full rounded border bg-background px-3"
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
            >
              {LIFETIMES.map((lifetime) => (
                <option key={lifetime.seconds} value={lifetime.seconds}>
                  {lifetime.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-muted-foreground">
              A link cannot be withdrawn once it is made: it works until it
              expires.
            </span>
          </label>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {made ? 'Done' : 'Cancel'}
          </Button>
          {!made && (
            <Button
              type="button"
              disabled={issue.isPending}
              onClick={() => issue.mutate()}
            >
              {issue.isPending && <Spinner className="size-3" />}
              Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WorkflowDto } from '@/generated/RuntaraRuntimeApi';
import { useCustomQuery } from '@/shared/hooks/api';
import { useToken } from '@/shared/hooks/useToken';
import { queryKeys } from '@/shared/queries/query-keys';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Spinner } from '@/shared/components/ui/spinner';
import { getWorkflows } from '@/features/workflows/queries';
import {
  getConversation,
  openConversation,
} from '@/features/workflows/queries/conversations';

/** The kinds of event a reply workflow may be started for, and what each
 * means to the one who sets it. The first two are what it is started for
 * unless set otherwise. */
const REPLY_EVENTS = [
  { kind: 'reply', label: 'Each reply' },
  { kind: 'waiting_for_input', label: 'Each time the run waits for input' },
  { kind: 'run_ended', label: 'When a run ends' },
  { kind: 'message_failed', label: 'When a message could not be delivered' },
] as const;

interface ConversationSettingsDialogProps {
  workflowId: string;
  conversationKey: string;
  onClose: () => void;
}

/**
 * A conversation's reply workflow: the workflow started with what the
 * conversation says, and for which kinds of event. An integration sets it
 * for the conversations it opens; a console chat has none unless given one.
 */
export function ConversationSettingsDialog({
  workflowId,
  conversationKey,
  onClose,
}: ConversationSettingsDialogProps) {
  const token = useToken();
  const queryClient = useQueryClient();
  const stateKey = [
    ...queryKeys.workflows.conversations(workflowId),
    conversationKey,
  ];

  const conversation = useQuery({
    queryKey: stateKey,
    queryFn: ({ signal }) =>
      getConversation(token, workflowId, conversationKey, signal),
    enabled: !!token,
  });
  const { data: listed } = useCustomQuery({
    queryKey: queryKeys.workflows.all,
    queryFn: getWorkflows,
  });
  const workflows: WorkflowDto[] =
    (listed as { data?: { content?: WorkflowDto[] } } | undefined)?.data
      ?.content ?? [];

  const [replyWorkflowId, setReplyWorkflowId] = useState('');
  const [replyEvents, setReplyEvents] = useState<string[]>([]);
  const loaded = conversation.data;
  useEffect(() => {
    if (!loaded) return;
    setReplyWorkflowId(loaded.replyWorkflowId ?? '');
    setReplyEvents(loaded.replyEvents);
  }, [loaded]);

  const save = useMutation({
    mutationFn: () =>
      openConversation(token, workflowId, conversationKey, {
        // Cleared, the route is removed: left out, it would be kept.
        replyWorkflowId: replyWorkflowId || null,
        replyEvents,
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(stateKey, state);
      onClose();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not save the settings'
      ),
  });

  const toggle = (kind: string, on: boolean) =>
    setReplyEvents((kinds) =>
      on
        ? [...kinds.filter((k) => k !== kind), kind]
        : kinds.filter((k) => k !== kind)
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Conversation settings</DialogTitle>
            <DialogDescription>
              A reply workflow is started with what this conversation says, to
              pass it on: to a chat platform, for example.
            </DialogDescription>
          </DialogHeader>

          {conversation.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-4" />
            </div>
          ) : conversation.isError ? (
            <p className="py-6 text-sm text-destructive">
              The conversation could not be read.
            </p>
          ) : (
            <div className="my-4 space-y-4">
              <label className="block text-sm">
                Reply workflow
                <select
                  aria-label="Reply workflow"
                  className="mt-1 block h-9 w-full rounded border bg-background px-3"
                  value={replyWorkflowId}
                  onChange={(event) => setReplyWorkflowId(event.target.value)}
                >
                  <option value="">None</option>
                  {/* One that is set but not listed is kept as it is. */}
                  {replyWorkflowId &&
                    !workflows.some((w) => w.id === replyWorkflowId) && (
                      <option value={replyWorkflowId}>{replyWorkflowId}</option>
                    )}
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="space-y-2" disabled={!replyWorkflowId}>
                <legend className="text-sm">Start it for</legend>
                {REPLY_EVENTS.map(({ kind, label }) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={replyEvents.includes(kind)}
                      disabled={!replyWorkflowId}
                      onCheckedChange={(checked) =>
                        toggle(kind, checked === true)
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!loaded || save.isPending}>
              {save.isPending && <Spinner className="size-3" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

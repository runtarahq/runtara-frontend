import { useEffect, useMemo } from 'react';
import { LinkIcon } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { formatDate } from '@/lib/utils';
import { ChatInput } from '@/features/workflows/components/ChatInput';
import { ChatMessageList } from '@/features/workflows/components/ChatMessageList';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import { withoutOpenRequests } from '@/features/workflows/stores/conversation-log';
import type { SharedChat } from '@/features/workflows/utils/shared-chat-link';
import { useConversationChat } from '../Chat/useChatStream';

/**
 * One conversation, for someone who was given a link to it and is not a
 * member. It talks to the workflow with the link's conversation token and
 * nothing else: no sign-in, no tenant, no user, and none of the console
 * around it.
 */
export function SharedChatPage({ chat }: { chat: SharedChat | null }) {
  if (!chat) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center px-4 text-center">
        <LinkIcon className="mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">This link is not complete</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Ask whoever sent it for the whole link, or for a new one.
        </p>
      </div>
    );
  }
  return <Conversation chat={chat} />;
}

function Conversation({ chat }: { chat: SharedChat }) {
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const loading = useChatStore((s) => s.loading);
  const title = useChatStore((s) => s.title);
  const error = useChatStore((s) => s.error);
  const waitingForInput = useChatStore((s) => s.waitingForInput);
  const pendingInputs = useChatStore((s) => s.pendingInputs);
  const hasEarlier = useChatStore((s) => s.hasEarlier);
  const loadingEarlier = useChatStore((s) => s.loadingEarlier);

  const {
    reconnect,
    sendMessage,
    submitInput,
    retryMessage,
    loadEarlier,
    stop,
    cancelStream,
    uncertainMessages,
  } = useConversationChat(chat.workflowId, chat.token, { restricted: true });

  useEffect(() => {
    const store = useChatStore.getState();
    store.initChat(chat.workflowId, 'Conversation');
    store.setSelf(chat.sender ?? null);
    void reconnect(chat.key);
    // Leaving stops reading. It does not stop the run.
    return () => {
      cancelStream();
      useChatStore.getState().resetChat();
    };
  }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = title || 'Conversation';
  }, [title]);

  // A line may lead into the console, where this page's reader cannot go.
  const shown = useMemo(
    () =>
      withoutOpenRequests(messages, pendingInputs)
        // What the runs did is the workspace's to see.
        .filter((m) => !m.activity)
        .map((m) => (m.link ? { ...m, link: undefined } : m)),
    [messages, pendingInputs]
  );
  const over = status === 'error';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {title || 'Conversation'}
          </h1>
          {chat.expiresAt && (
            <p className="truncate text-xs text-muted-foreground">
              This link works until {formatDate(chat.expiresAt)}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mt-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div
          className="flex flex-1 flex-col gap-3 px-4 py-4"
          role="status"
          aria-label="Loading the conversation"
        >
          <Skeleton className="h-10 w-2/5 self-end" />
          <Skeleton className="h-16 w-3/5" />
        </div>
      ) : (
        <ChatMessageList
          messages={shown}
          hasEarlier={hasEarlier}
          loadingEarlier={loadingEarlier}
          onLoadEarlier={() => void loadEarlier()}
          working={
            status === 'streaming' && !messages.some((m) => m.isStreaming)
          }
          asked={pendingInputs.length > 0}
        />
      )}

      {uncertainMessages.map(({ id, message }) => (
        <div key={id} className="space-y-2 border-t px-4 py-2 text-sm">
          <p>Message receipt is unconfirmed: {message}</p>
          <Button
            variant="secondary"
            aria-label={`Retry this message: ${message}`}
            onClick={() => void retryMessage(id)}
          >
            Retry this message
          </Button>
        </div>
      ))}

      {/* A link that is no longer taken has nothing to send to. */}
      {!over && (
        <ChatInput
          onSend={sendMessage}
          onSignalResponse={sendMessage}
          onStop={() => void stop()}
          status={status}
          waitingForInput={waitingForInput}
          pendingInputs={pendingInputs}
          onSelectInput={(input) =>
            useChatStore.getState().setWaitingForInput(input)
          }
          onSubmitInput={submitInput}
        />
      )}
    </div>
  );
}

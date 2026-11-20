import { useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatMessage } from '@/features/workflows/types/chat';
import { ChatBubble } from '@/features/workflows/components/ChatBubble';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** Whether the conversation has more before the first message shown. */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  /** Asked for when the list is scrolled to its top, or by its button. */
  onLoadEarlier?: () => void;
}

/** How near the top counts as having scrolled up to it. */
const TOP = 40;

export function ChatMessageList({
  messages,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows at its end: a new last message, or
  // more of the last one. Messages added above are not a reason to move.
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const lastLength = last?.content?.length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [lastId, lastLength]);

  // Earlier messages go above what is read: hold the place being read by
  // moving down by as much as was added.
  const firstId = messages[0]?.id;
  const before = useRef({ firstId, height: 0 });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (before.current.firstId && before.current.firstId !== firstId)
      container.scrollTop += container.scrollHeight - before.current.height;
    before.current = { firstId, height: container.scrollHeight };
  });

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <MessageSquare className="mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">
          Start a conversation
        </p>
        <p className="text-xs text-muted-foreground">
          Type a message to begin chatting with this workflow.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      onScroll={(event) => {
        if (
          hasEarlier &&
          !loadingEarlier &&
          event.currentTarget.scrollTop <= TOP
        )
          onLoadEarlier?.();
      }}
    >
      {hasEarlier && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingEarlier}
            onClick={onLoadEarlier}
          >
            {loadingEarlier && <Spinner className="size-3" />}
            Load earlier messages
          </Button>
        </div>
      )}
      {messages.map((message) => (
        <ChatBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

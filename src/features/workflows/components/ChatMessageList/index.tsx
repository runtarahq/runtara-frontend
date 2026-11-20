import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, MessageSquare } from 'lucide-react';
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
  /** Whether a run is busy with nothing of a reply to show yet. */
  working?: boolean;
}

/** How near the top counts as having scrolled up to it. */
const TOP = 40;
/** How near the end counts as reading the latest. */
const END = 80;

export function ChatMessageList({
  messages,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  working = false,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the end: only then does the list follow what
  // is added. Someone reading further up is left where they are.
  const atEnd = useRef(true);
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  const toEnd = (behavior: ScrollBehavior = 'smooth') =>
    bottomRef.current?.scrollIntoView?.({ behavior, block: 'end' });

  // Follow the conversation as it grows at its end: a new last message, or
  // more of the last one. What the reader says themself always shows.
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const lastLength = last?.content?.length;
  const lastIsOwn = last?.role === 'user' && !last.sender;
  useEffect(() => {
    if (atEnd.current || lastIsOwn) {
      atEnd.current = true;
      setAwayFromEnd(false);
      toEnd();
    }
  }, [lastId, lastLength, lastIsOwn, working]);

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

  if (messages.length === 0 && !working) {
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        onScroll={(event) => {
          const list = event.currentTarget;
          const fromEnd =
            list.scrollHeight - list.scrollTop - list.clientHeight;
          atEnd.current = fromEnd <= END;
          setAwayFromEnd(!atEnd.current);
          if (hasEarlier && !loadingEarlier && list.scrollTop <= TOP)
            onLoadEarlier?.();
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
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
          {working && (
            <div
              role="status"
              aria-label="Working"
              className="flex items-center gap-1 px-1 py-2"
            >
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                  style={{ animationDelay: `${String(delay)}ms` }}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {awayFromEnd && (
        <Button
          variant="secondary"
          size="icon"
          bordered
          className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full bg-background shadow"
          aria-label="Go to the latest message"
          onClick={() => {
            atEnd.current = true;
            setAwayFromEnd(false);
            toEnd();
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}

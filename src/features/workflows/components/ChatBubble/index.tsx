import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Wrench,
  Check,
  Brain,
  Database,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge.tsx';
import { cn } from '@/lib/utils.ts';
import {
  ChatAttachment,
  ChatMessage,
  ChatSSEEvent,
} from '@/features/workflows/types/chat';
import { Spinner } from '@/shared/components/ui/spinner';

interface ChatBubbleProps {
  message: ChatMessage;
}

function EventDetails({ events }: { events: ChatSSEEvent[] }) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;

  // Build a compact summary of events
  const toolCalls = events.filter(
    (e) => e.type === 'tool_call' || e.type === 'tool_result'
  );
  const llmEvents = events.filter(
    (e) => e.type === 'llm_start' || e.type === 'llm_end'
  );
  const memoryEvents = events.filter((e) => e.type === 'memory_saved');

  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span className="flex items-center gap-1.5">
          {llmEvents.length > 0 && (
            <Badge variant="outline" className="gap-1 py-0 text-3xs">
              <Brain className="size-2.5" />
              LLM
            </Badge>
          )}
          {toolCalls.length > 0 && (
            <Badge variant="outline" className="gap-1 py-0 text-3xs">
              <Wrench className="size-2.5" />
              {toolCalls.filter((e) => e.type === 'tool_call').length} tool call
              {toolCalls.filter((e) => e.type === 'tool_call').length !== 1
                ? 's'
                : ''}
            </Badge>
          )}
          {memoryEvents.length > 0 && (
            <Badge variant="outline" className="gap-1 py-0 text-3xs">
              <Database className="size-2.5" />
              Memory saved
            </Badge>
          )}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {events.map((event, i) => (
            <EventItem key={i} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventItem({ event }: { event: ChatSSEEvent }) {
  switch (event.type) {
    case 'tool_call':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wrench className="size-3 text-primary-text" />
          <span>
            Calling{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-3xs">
              {(event.data.tool_name as string) ?? 'tool'}
            </code>
          </span>
        </div>
      );
    case 'tool_result': {
      const duration = event.data.duration_ms as number | undefined;
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3 text-success" />
          <span>
            <code className="rounded bg-muted px-1 py-0.5 text-3xs">
              {(event.data.tool_name as string) ?? 'tool'}
            </code>
            {duration != null && (
              <span className="ml-1 text-muted-foreground/70">
                ({String(duration)}ms)
              </span>
            )}
          </span>
        </div>
      );
    }
    case 'llm_start': {
      const model = event.data.model as string | undefined;
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Brain className="size-3 text-violet-500" />
          <span>
            Thinking
            {model && (
              <span className="ml-1 text-muted-foreground/70">({model})</span>
            )}
          </span>
        </div>
      );
    }
    case 'llm_end':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3 text-violet-500" />
          <span>Done thinking</span>
        </div>
      );
    case 'memory_saved':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database className="size-3 text-success" />
          <span>
            Memory saved ({(event.data.message_count as number) ?? '?'}{' '}
            messages)
          </span>
        </div>
      );
    default:
      return null;
  }
}

/** The data a reply carries beside its text, closed until asked for. */
function ReplyData({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <Braces className="size-3" />
        Data
      </button>
      {expanded && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Only a link that is plainly one is followed: a workflow writes these. */
function isLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function Attachments({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((attachment, at) => (
        <li key={at} className="flex items-center gap-1.5 text-xs">
          <Paperclip className="size-3 shrink-0 text-muted-foreground" />
          {isLink(attachment.url) ? (
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate underline"
            >
              {attachment.name || attachment.url}
            </a>
          ) : (
            <span className="truncate">
              {attachment.name || attachment.url}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const { role, content, events, isStreaming, sender } = message;
  const { format, data, attachments, tone, failure } = message;
  const hasData = data !== undefined && data !== null;

  if (role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        {sender && (
          <span className="px-1 text-xs text-muted-foreground">{sender}</span>
        )}
        <div
          className={cn(
            'max-w-[80%] rounded-lg rounded-tr-md px-4 py-2.5 text-sm',
            // Someone else's message is told apart from this page's own.
            sender
              ? 'border bg-muted text-foreground'
              : 'bg-primary text-primary-foreground'
          )}
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
        {failure && (
          <span className="flex items-center gap-1 px-1 text-xs text-destructive">
            <AlertCircle className="size-3" />
            Not delivered: {failure}
          </span>
        )}
      </div>
    );
  }

  if (role === 'system') {
    return (
      <div className="flex justify-center">
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs',
            tone === 'error'
              ? 'bg-destructive/10 text-destructive'
              : tone === 'warning'
                ? 'bg-warning/10 text-warning'
                : 'bg-muted/50 text-muted-foreground'
          )}
        >
          {(tone || events.some((e) => e.type === 'waiting_for_input')) && (
            <AlertCircle className={cn('size-3', !tone && 'text-warning')} />
          )}
          <span>{content}</span>
        </div>
      </div>
    );
  }

  // Don't render empty assistant bubbles (placeholder was created but no content arrived)
  if (
    !content &&
    !isStreaming &&
    events.length === 0 &&
    !hasData &&
    !attachments?.length
  ) {
    return null;
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[80%] rounded-lg rounded-tl-md border bg-card px-4 py-2.5 text-sm',
          isStreaming && !content && 'animate-pulse'
        )}
      >
        {content && format === 'plain' ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : content ? (
          <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-3.5" />
            <span className="text-xs">Thinking...</span>
          </div>
        ) : null}

        {isStreaming && content && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
        )}

        {!!attachments?.length && <Attachments attachments={attachments} />}
        {hasData && <ReplyData data={data} />}
        <EventDetails events={events} />
      </div>
    </div>
  );
}

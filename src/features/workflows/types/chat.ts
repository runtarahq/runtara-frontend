// Chat feature type definitions

export type ChatSSEEventType =
  | 'started'
  | 'memory_loaded'
  | 'llm_start'
  | 'llm_end'
  | 'tool_call'
  | 'tool_result'
  | 'waiting_for_input'
  | 'message'
  | 'memory_saved'
  | 'done'
  | 'error';

export interface ChatSSEEvent {
  type: ChatSSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: string;
  /** SSE events associated with this message (tool calls, memory ops, etc.) */
  events: ChatSSEEvent[];
  /** Whether the message is still being streamed */
  isStreaming?: boolean;
  /** The id of the message this line belongs to: the one that started the
   * run, or the one that answered what it waited for. */
  turn?: string;
  /** Who said it, where it was not this page's user: an adapter's user, or
   * another workflow. */
  sender?: string;
  /** What a reply's text is written in. Markdown unless it says otherwise. */
  format?: 'markdown' | 'plain';
  /** Structured data a reply carries beside its text. */
  data?: unknown;
  /** Files a reply names: the conversation keeps none of them. */
  attachments?: ChatAttachment[];
  /** A line that reports a failure, or something to look into. */
  tone?: 'error' | 'warning';
  /** Why a message this line shows was not taken. */
  failure?: string;
  /** A message that waits its turn: the run is busy with another. */
  queued?: boolean;
  /** The request a message answers (`inReplyTo`). */
  answers?: string;
  /** A reply whose run ended before it was said whole: what was written of
   * it is all there is. */
  incomplete?: boolean;
  /** A reply joined in the middle of its writing: its pieces cannot be put
   * together, so it is shown when it is said whole. */
  joinedLate?: boolean;
}

export interface ChatAttachment {
  name: string;
  url: string;
  contentType?: string | null;
}

export type ChatStatus =
  'idle' | 'streaming' | 'waiting_for_input' | 'done' | 'error';

export interface WaitingForInputData {
  /** Original target, retained when the conversation moves to its next run after a lost acknowledgement. */
  instanceId?: string;
  requestId: string;
  /** Present when the request was read from the run, not announced by the
   * conversation. */
  signalId?: string;
  message?: string;
  responseSchema?: Record<string, unknown> | null;
  toolName?: string | null;
}

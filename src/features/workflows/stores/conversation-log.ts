import type {
  ConversationEvent,
  ConversationState,
  Message,
  Reply,
  ReplyDelta,
  WaitingForInput,
} from '@/generated/RuntaraRuntimeApi';
import type { ChatMessage, ChatStatus } from '../types/chat';
import type { WaitingForInputData } from '../types/chat';

/**
 * What the chat shows of a conversation, and how each event of the
 * conversation's log changes it. Each thing is read once, from the event
 * that is meant to carry it, and every line has an id made from its event:
 * the same event read again changes nothing.
 */
export interface ConversationLog {
  messages: ChatMessage[];
  instanceId: string | null;
  status: ChatStatus;
  /** Whether what was kept is still being read: until the stream says it
   * has caught up, the transcript is not whole. */
  loading: boolean;
  /** The last kept event applied. */
  lastSeq: number;
  waitingForInput: WaitingForInputData | null;
  pendingInputs: WaitingForInputData[];
  pendingInputError: string | null;
}

/** The id of the line a message is shown as. */
export function messageLineId(messageId: string): string {
  return `message:${messageId}`;
}

/** A reply with an id of its own is one line, however often it is read. The
 * id is the author's and is said once in its run, not in its conversation. */
function replyLineId(seq: number, reply: Reply): string {
  return reply.replyId
    ? writtenLineId(reply.instanceId ?? '', reply.replyId)
    : `seq:${String(seq)}`;
}

function writtenLineId(instanceId: string, replyId: string): string {
  return `reply:${instanceId}:${replyId}`;
}

/** What a message says, as text: its own, or what it carries. An answer to
 * a form is its fields, one to a line. */
export function messageText(
  message: Pick<Message, 'text' | 'payload'>
): string {
  if (message.text) return message.text;
  const payload: unknown = message.payload;
  if (!payload || typeof payload !== 'object') return '';
  const fields = Object.entries(payload as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null
  );
  if (fields.length === 0) return '';
  if (fields.length === 1 && typeof fields[0][1] === 'string')
    return fields[0][1];
  return fields
    .map(
      ([name, value]) =>
        `${name}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    )
    .join('\n');
}

/** The request a run waits on, as the conversation announces it. */
function requestFrom(waiting: WaitingForInput): WaitingForInputData {
  return {
    requestId: waiting.requestId,
    instanceId: waiting.instanceId,
    message: waiting.message,
    responseSchema: (waiting.responseSchema ?? null) as Record<
      string,
      unknown
    > | null,
    toolName: waiting.toolName ?? null,
  };
}

/** The run waits on this request: it is the one to answer, in place of any
 * announced before it. */
function awaitInput(log: ConversationLog, request: WaitingForInputData) {
  const known = log.pendingInputs.find(
    (r) => r.requestId === request.requestId
  );
  // Kept as it was where it is known, so a form being filled is not reset.
  log.pendingInputs = [known ?? request];
  log.waitingForInput = log.pendingInputs[0];
  log.pendingInputError = null;
  log.status = 'waiting_for_input';
}

/** A request is answered or gone: it is no longer offered. */
export function closeRequest(log: ConversationLog, requestId: string) {
  log.pendingInputs = log.pendingInputs.filter(
    (r) => r.requestId !== requestId
  );
  if (log.waitingForInput?.requestId === requestId)
    log.waitingForInput =
      log.pendingInputs.length === 1 ? log.pendingInputs[0] : null;
}

/**
 * Puts a line in the transcript, in place of the one with its id if there is
 * one. A new line goes under the last line of its turn: a message sent while
 * a run is busy is logged before that run's later replies, and each answer
 * still belongs under its own question.
 */
function put(log: ConversationLog, line: ChatMessage) {
  const at = log.messages.findIndex((m) => m.id === line.id);
  if (at >= 0) {
    log.messages[at] = { ...log.messages[at], ...line };
    return;
  }
  let last = -1;
  if (line.turn)
    log.messages.forEach((m, index) => {
      if (m.turn === line.turn) last = index;
    });
  if (last >= 0) log.messages.splice(last + 1, 0, line);
  else log.messages.push(line);
}

function line(
  event: ConversationEvent,
  id: string,
  role: ChatMessage['role'],
  content: string
): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: event.createdAt,
    events: [],
    ...(event.turn ? { turn: event.turn } : {}),
  };
}

function note(
  log: ConversationLog,
  event: ConversationEvent,
  text: string,
  tone?: ChatMessage['tone']
) {
  put(log, {
    ...line(event, `seq:${String(event.seq)}`, 'system', text),
    ...(tone ? { tone } : {}),
  });
}

/** The line an AI Agent step's answer is shown as until the run says it. */
const AGENT_LINE = 'agent:';

/**
 * What a run is doing, as the conversation relays it (`activity`): model and
 * tool calls and memory, each a line in the transcript.
 */
function applyActivity(log: ConversationLog, event: ConversationEvent) {
  const body = (event.body ?? {}) as Record<string, unknown>;
  switch (body.type) {
    case 'memory_loaded': {
      const outputs = body.outputs as Record<string, unknown> | undefined;
      const count = body.message_count ?? outputs?.message_count ?? 0;
      note(log, event, `Loaded ${String(count)} messages from memory`);
      break;
    }
    case 'llm_start': {
      const model = body.model as string | undefined;
      note(log, event, model ? `${model} thinking...` : 'Thinking...');
      break;
    }
    case 'llm_end':
      note(log, event, 'Done thinking');
      break;
    case 'tool_call':
      note(log, event, `Calling tool: ${(body.tool_name as string) ?? 'tool'}`);
      break;
    case 'tool_result': {
      const toolName = (body.tool_name as string) ?? 'tool';
      const durationMs = body.duration_ms as number | undefined;
      const duration = durationMs != null ? ` (${String(durationMs)}ms)` : '';
      note(log, event, `${toolName} completed${duration}`);
      break;
    }
    case 'memory_saved':
      note(
        log,
        event,
        `Saved ${String(body.message_count ?? 0)} messages to memory`
      );
      break;
    case 'message':
      // An AI Agent step's answer, before the run says or returns it. It is
      // shown until a reply follows in its turn, which then stands for it.
      if (typeof body.content === 'string' && body.content.trim())
        put(
          log,
          line(
            event,
            `${AGENT_LINE}${String(event.seq)}`,
            'assistant',
            body.content
          )
        );
      break;
  }
}

function setInstance(log: ConversationLog, instanceId: string) {
  if (log.instanceId !== instanceId) {
    log.pendingInputs = [];
    log.waitingForInput = null;
    log.pendingInputError = null;
  }
  log.instanceId = instanceId;
}

/** Applies one kept event of the conversation to what the chat shows. A
 * kind this console does not know changes nothing. */
export function applyEvent(log: ConversationLog, event: ConversationEvent) {
  if (event.seq > log.lastSeq) log.lastSeq = event.seq;
  switch (event.kind) {
    case 'message': {
      const text = messageText(event.body);
      // A message that says nothing is how a chat is opened: the workflow
      // begins, and no one is shown to have spoken.
      if (!text) break;
      const sender = event.body.sender;
      put(log, {
        ...line(event, messageLineId(event.body.id), 'user', text),
        ...(sender ? { sender: sender.name || sender.id } : {}),
        ...(event.body.inReplyTo ? { answers: event.body.inReplyTo } : {}),
      });
      break;
    }

    case 'run_started':
      setInstance(log, event.body.instanceId);
      note(log, event, 'Execution started');
      log.status = 'streaming';
      break;

    case 'message_delivered':
      // The message answered this request: the run goes on with it.
      closeRequest(log, event.body.requestId);
      log.status = log.pendingInputs.length ? 'waiting_for_input' : 'streaming';
      break;

    case 'activity':
      applyActivity(log, event);
      break;

    case 'reply': {
      const { text, data, format } = event.body;
      const attachments = event.body.attachments ?? [];
      const hasData = data !== undefined && data !== null;
      if (!text?.trim() && !attachments.length && !hasData) break;
      if (event.turn)
        log.messages = log.messages.filter(
          (m) => !(m.id.startsWith(AGENT_LINE) && m.turn === event.turn)
        );
      put(log, {
        ...line(
          event,
          replyLineId(event.seq, event.body),
          'assistant',
          text ?? ''
        ),
        format: format === 'plain' ? 'plain' : 'markdown',
        // Said whole: whatever was written of it in pieces is replaced.
        isStreaming: false,
        joinedLate: false,
        ...(hasData ? { data } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      break;
    }

    case 'waiting_for_input': {
      awaitInput(log, requestFrom(event.body));
      // Only a structured request is announced in the transcript; a plain
      // "message" one is the chat's own input box.
      const schema: unknown = event.body.responseSchema;
      const keys =
        schema && typeof schema === 'object' ? Object.keys(schema) : [];
      const isSimple =
        keys.length === 0 || (keys.length === 1 && keys[0] === 'message');
      if (!isSimple)
        note(log, event, event.body.message || 'Waiting for input...');
      break;
    }

    case 'message_failed': {
      // Said of the message where it is shown. One that is not (the opening
      // message) is said of on its own.
      const reason = event.body.reason || 'The message could not be delivered';
      const failed = log.messages.find(
        (m) => m.id === messageLineId(event.body.messageId)
      );
      if (failed) failed.failure = reason;
      else note(log, event, reason, 'error');
      break;
    }

    case 'reply_route_failed':
      note(
        log,
        event,
        `The reply workflow could not be started: ${event.body.reason}`,
        'warning'
      );
      break;

    case 'run_ended':
      // One run of the conversation is over; the next message starts the
      // next one. A failure is a line where it happened, not a state of the
      // chat: the conversation goes on.
      if (event.body.status !== 'completed')
        note(
          log,
          event,
          `Error: ${event.body.error ?? 'Execution failed'}`,
          'error'
        );
      // A reply it was writing and never said whole stays as far as it got.
      for (const written of log.messages) {
        if (
          written.isStreaming &&
          written.id.startsWith(writtenLineId(event.body.instanceId, ''))
        ) {
          written.isStreaming = false;
          written.incomplete = true;
        }
      }
      // Whatever it waited for is no longer waited for.
      log.pendingInputs = [];
      log.waitingForInput = null;
      log.status = 'idle';
      break;
  }
}

/**
 * Sets what the chat is doing from the conversation as it stands, once what
 * was kept has been read: whether a run carries it and whether that run
 * waits. A state older than the events already applied is left alone, since
 * those events have said more.
 */
export function applyState(log: ConversationLog, state: ConversationState) {
  if (state.lastSeq < log.lastSeq) return;
  if (state.instanceId) setInstance(log, state.instanceId);
  const waiting = state.waitingFor as WaitingForInput | null | undefined;
  if (waiting?.requestId) {
    awaitInput(log, requestFrom(waiting));
    return;
  }
  log.pendingInputs = [];
  log.waitingForInput = null;
  if (state.instanceId) log.status = 'streaming';
  else if (log.status !== 'error') log.status = 'idle';
}

/**
 * Applies the pieces of replies as they are written (`reply_delta`). They
 * are not kept and not numbered, so they are placed by where each begins in
 * its reply (`offset`), not by when it arrived: a stream that is opened
 * again is sent a reply's pieces from its first.
 */
export function applyPieces(log: ConversationLog, pieces: ReplyDelta[]) {
  for (const piece of pieces) {
    const id = writtenLineId(piece.instanceId, piece.replyId);
    const written = log.messages.find((m) => m.id === id);
    if (!written) {
      log.messages.push({
        id,
        role: 'assistant',
        // A reply joined in the middle is shown when it is said whole.
        content: piece.offset === 0 ? piece.text : '',
        timestamp: new Date().toISOString(),
        events: [],
        isStreaming: true,
        ...(piece.offset === 0 ? {} : { joinedLate: true }),
      });
      continue;
    }
    // Said whole already, or not to be put together: nothing to add.
    if (!written.isStreaming || written.joinedLate) continue;
    const has = written.content.length;
    if (piece.offset > has) {
      written.joinedLate = true;
      written.content = '';
    } else if (piece.offset + piece.text.length > has) {
      // The next piece, or one that repeats some of what is there.
      written.content = written.content.slice(0, piece.offset) + piece.text;
    }
  }
}

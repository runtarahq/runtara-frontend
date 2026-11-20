import type {
  ConversationEvent,
  Message,
  Reply,
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
  error: string | null;
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
    ? `reply:${reply.instanceId ?? ''}:${reply.replyId}`
    : `seq:${String(seq)}`;
}

/** What a message says, as text: its own, or what it carries. */
export function messageText(
  message: Pick<Message, 'text' | 'payload'>
): string {
  if (message.text) return message.text;
  const payload: unknown = message.payload;
  if (!payload || typeof payload !== 'object') return '';
  const fields = Object.entries(payload as Record<string, unknown>);
  if (fields.length === 0) return '';
  if (fields.length === 1 && typeof fields[0][1] === 'string')
    return fields[0][1];
  return JSON.stringify(payload);
}

/** What a reply carries, as text: its own, then its attachments. */
function replyText(reply: Reply): string {
  const links = (reply.attachments ?? []).map(
    (a) => `[${a.name || a.url}](${a.url})`
  );
  return [reply.text ?? '', ...links].filter(Boolean).join('\n');
}

/** Puts a line in the transcript, in place of the one with its id if there
 * is one. */
function put(log: ConversationLog, line: ChatMessage) {
  const at = log.messages.findIndex((m) => m.id === line.id);
  if (at >= 0) log.messages[at] = { ...log.messages[at], ...line };
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

function note(log: ConversationLog, event: ConversationEvent, text: string) {
  put(log, line(event, `seq:${String(event.seq)}`, 'system', text));
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
  switch (event.kind) {
    case 'message': {
      const text = messageText(event.body);
      // A message that says nothing is how a chat is opened: the workflow
      // begins, and no one is shown to have spoken.
      if (text)
        put(log, line(event, messageLineId(event.body.id), 'user', text));
      break;
    }

    case 'run_started':
      setInstance(log, event.body.instanceId);
      note(log, event, 'Execution started');
      log.status = 'streaming';
      break;

    case 'message_delivered':
      log.status = 'streaming';
      break;

    case 'activity':
      applyActivity(log, event);
      break;

    case 'reply': {
      const text = replyText(event.body);
      if (!text.trim()) break;
      if (event.turn)
        log.messages = log.messages.filter(
          (m) => !(m.id.startsWith(AGENT_LINE) && m.turn === event.turn)
        );
      put(
        log,
        line(event, replyLineId(event.seq, event.body), 'assistant', text)
      );
      break;
    }

    case 'waiting_for_input': {
      // Only a structured request is announced; a plain "message" one is the
      // chat's own input box. Managed discovery controls actionable forms.
      const schema: unknown = event.body.responseSchema;
      const keys =
        schema && typeof schema === 'object' ? Object.keys(schema) : [];
      const isSimple =
        keys.length === 0 || (keys.length === 1 && keys[0] === 'message');
      if (!isSimple)
        note(log, event, event.body.message || 'Waiting for input...');
      break;
    }

    case 'message_failed':
      log.error = event.body.reason || 'The message could not be delivered';
      break;

    case 'run_ended':
      // One run of the conversation is over; the next message starts the
      // next one.
      if (event.body.status === 'completed') {
        log.status = log.pendingInputs.length ? 'waiting_for_input' : 'idle';
      } else {
        log.error = event.body.error ?? 'Execution failed';
        log.status = 'error';
      }
      break;
  }
}

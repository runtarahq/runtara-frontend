import { ChatMessage, ChatSSEEvent } from '@/features/workflows/types/chat';
import { runtimeFetch } from '@/shared/queries/runtime-fetch';
import { InputSubmissionError } from '../utils/input-submission';

// ---------------------------------------------------------------------------
// A conversation with a workflow
// ---------------------------------------------------------------------------

/** Something a conversation has for its user. Numbered, and kept. */
export interface ConversationEvent {
  seq: number;
  kind: string;
  body: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationMessage {
  /** The sender's own id for it: the same id again is the same message. */
  id: string;
  text?: string;
  payload?: Record<string, unknown>;
}

export interface SentMessage {
  messageId: string;
  state: 'queued' | 'started' | 'delivered' | 'failed';
  instanceId?: string;
  detail?: string;
  duplicate: boolean;
}

function conversationPath(workflowId: string, key: string): string {
  return `/workflows/${encodeURIComponent(workflowId)}/conversations/${encodeURIComponent(key)}`;
}

/**
 * Send a message into a conversation, which is opened if it was not. It
 * starts a run, answers a waiting one, or waits its turn; the answer says
 * which. A refusal (a full queue, a malformed message) is an
 * `InputSubmissionError` with its status.
 */
export async function sendConversationMessage(
  workflowId: string,
  key: string,
  message: ConversationMessage,
  signal?: AbortSignal
): Promise<SentMessage> {
  const response = await runtimeFetch(
    `${conversationPath(workflowId, key)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal,
    }
  );
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: SentMessage;
    code?: string;
    message?: string;
  };
  if (!response.ok || !body.success || !body.data) {
    throw new InputSubmissionError(
      body.message ?? 'The message could not be sent',
      body.code,
      response.status
    );
  }
  if (body.data.messageId !== message.id) {
    throw new InputSubmissionError('The message could not be confirmed');
  }
  return body.data;
}

/**
 * The conversation's events after `after`, as a stream. The server ends a
 * stream after a while; the caller reads on from the last event it saw.
 */
export async function streamConversationEvents(
  workflowId: string,
  key: string,
  after: number,
  signal?: AbortSignal
): Promise<Response> {
  const response = await runtimeFetch(
    `${conversationPath(workflowId, key)}/events?after=${String(after)}`,
    { headers: { Accept: 'text/event-stream' }, signal }
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`The conversation could not be read: ${errorText}`);
  }
  return response;
}

/**
 * Reconstruct chat history from instance step events.
 * Parses SSE-like events from the step events API and builds ChatMessage[].
 */
export async function fetchChatHistory(
  workflowId: string,
  instanceId: string
): Promise<ChatMessage[]> {
  const response = await runtimeFetch(
    `/workflows/${encodeURIComponent(workflowId)}/instances/${encodeURIComponent(instanceId)}/step-events?sortOrder=asc&limit=1000`,
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch chat history: ${response.statusText}`);
  }

  const json = await response.json();
  const events: Record<string, unknown>[] =
    json?.data?.events ?? json?.events ?? [];

  return reconstructMessagesFromEvents(events);
}

/**
 * Pull the AI Agent's final prose reply out of a workflow `completed`
 * event payload. Returns `null` when there's no chat-shaped output (the
 * caller should fall back to a generic "Completed" system message).
 *
 * Recognised shapes:
 *   - `payload.answer.response: string`  — Finish step receives the
 *     full AiAgent outputs object (`{iterations, response, toolCalls}`).
 *     This is the convention the demo workflows use.
 *   - `payload.answer: string`           — Finish maps `answer` directly
 *     to a single string (e.g. `steps.agent.outputs.response`).
 *   - `payload.response: string`         — Finish exposes `response` at
 *     the top level.
 *   - `payload.message: string`          — same convention as channel
 *     adapters (telegram/slack) use for their reply field.
 */
function extractAssistantText(
  payload: Record<string, unknown> | undefined
): string | null {
  if (!payload) return null;
  const answer = payload.answer as Record<string, unknown> | string | undefined;
  if (typeof answer === 'string' && answer.trim()) return answer;
  if (answer && typeof answer === 'object') {
    const resp = (answer as Record<string, unknown>).response;
    if (typeof resp === 'string' && resp.trim()) return resp;
  }
  const top = payload.response ?? payload.message;
  if (typeof top === 'string' && top.trim()) return top;
  return null;
}

/**
 * Resolve a human-friendly tool label for an `AiAgentToolCall`
 * step_debug_end event.
 *
 * The AI-Agent codegen names tool-call sub-steps in two flavours:
 *   - `"Tool: <toolName>"`                  — regular edge-tools, set
 *     from the workflow author's step name.
 *   - `"<agent>.tool.<toolName>.<counter>"` — synthetic MCP tools
 *     (e.g. `agent.tool.runtara_search.1`) where step_id IS the label.
 * In the synthetic case `step_name.replace('Tool: ', '')` returns the
 * raw step_id, so we parse the toolName out of the structured id
 * instead.
 */
function extractToolLabel(
  payload: Record<string, unknown>,
  stepName: string | undefined
): string {
  // 1. Tool args may carry the literal tool_name for MCP `_invoke`-style
  //    dispatches (the meta-tool wraps the real tool name as an arg).
  const inputs = payload.inputs as Record<string, unknown> | undefined;
  const fromArgs = inputs?.tool_name;
  if (typeof fromArgs === 'string' && fromArgs.trim()) return fromArgs;

  // 2. "Tool: foo" → "foo" (regular edge tools).
  if (stepName && stepName.startsWith('Tool: ')) {
    return stepName.slice('Tool: '.length);
  }

  // 3. Synthetic MCP step ids: "<agent>.tool.<toolName>.<counter>".
  const stepId = payload.step_id as string | undefined;
  if (stepId) {
    const idx = stepId.indexOf('.tool.');
    if (idx >= 0) {
      const after = stepId.slice(idx + '.tool.'.length);
      const dot = after.lastIndexOf('.');
      const tool = dot > 0 ? after.slice(0, dot) : after;
      if (tool) return tool;
    }
  }

  // 4. Last resort: the bare step name or a generic placeholder.
  return stepName ?? 'tool';
}

/**
 * Convert raw step events from the step-events API into ChatMessage objects.
 * Each significant event becomes its own message in the chat timeline.
 *
 * Step events have this shape:
 *   { eventType, subtype?, payload?, createdAt, id }
 */
function reconstructMessagesFromEvents(
  events: Record<string, unknown>[]
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let msgCounter = 0;

  const makeId = () => {
    msgCounter += 1;
    return `history_${msgCounter}`;
  };

  const addSystem = (
    content: string,
    timestamp: string,
    sseEvents: ChatSSEEvent[] = []
  ) => {
    messages.push({
      id: makeId(),
      role: 'system',
      content,
      timestamp,
      events: sseEvents,
    });
  };

  for (const event of events) {
    const eventType = event.eventType as string | undefined;
    const subtype = event.subtype as string | undefined;
    const payload = event.payload as Record<string, unknown> | undefined;
    const createdAt = (event.createdAt as string) ?? new Date().toISOString();

    if (!eventType) continue;

    // Skip heartbeats
    if (eventType === 'heartbeat') continue;

    // Execution started
    if (eventType === 'started') {
      addSystem('Execution started', createdAt);
      continue;
    }

    // Execution completed — surface the AI Agent's prose reply as an
    // assistant bubble when the workflow output looks chat-shaped.
    //
    // Workflows authored for chat typically route the AI Agent step's
    // outputs into a Finish step's `answer` field, so the completion
    // payload's `answer.response` carries the model's final text.
    // We also accept `answer` being a plain string for simpler shapes,
    // and fall through to a generic "Completed" line otherwise.
    if (eventType === 'completed') {
      const completionText = extractAssistantText(payload);
      if (completionText) {
        messages.push({
          id: makeId(),
          role: 'assistant',
          content: completionText,
          timestamp: createdAt,
          events: [],
        });
      } else {
        addSystem('Completed', createdAt);
      }
      continue;
    }

    // Execution failed
    if (eventType === 'failed') {
      addSystem(
        `Error: ${(payload?.message as string) ?? 'Execution failed'}`,
        createdAt
      );
      continue;
    }

    // Custom events — examine subtype
    if (eventType === 'custom' && subtype && payload) {
      const stepType = payload.step_type as string | undefined;
      const stepName = payload.step_name as string | undefined;
      const durationMs = payload.duration_ms as number | undefined;

      // External input requested (WaitForSignal)
      if (subtype === 'external_input_requested') {
        const waitEvent: ChatSSEEvent = {
          type: 'waiting_for_input',
          data: {
            signal_id: payload.signal_id,
            message: payload.message,
            response_schema: payload.response_schema,
            tool_name: payload.tool_name,
          },
          timestamp: createdAt,
        };
        const promptMsg = (payload.message as string) ?? 'Waiting for input...';
        addSystem(promptMsg, createdAt, [waitEvent]);
        continue;
      }

      // Step debug start
      if (subtype === 'step_debug_start') {
        if (stepType === 'AiAgentMemoryLoad') {
          addSystem('Loading memory...', createdAt);
        } else if (stepType === 'AiAgentToolCall') {
          const inputs = payload.inputs as Record<string, unknown> | undefined;
          const toolName = (inputs?.tool_name as string) ?? stepName ?? 'tool';
          addSystem(`Calling tool: ${toolName}`, createdAt);
        } else if (stepType === 'AiAgentLlmCall' || stepType === 'AiAgent') {
          addSystem(`${stepName ?? 'AI Agent'} thinking...`, createdAt);
        } else if (stepType === 'AiAgentMemorySave') {
          addSystem('Saving memory...', createdAt);
        } else {
          addSystem(`${stepName ?? stepType ?? 'Step'} started`, createdAt);
        }
        continue;
      }

      // Step debug end
      if (subtype === 'step_debug_end') {
        const durationStr =
          durationMs != null ? ` (${String(durationMs)}ms)` : '';

        if (stepType === 'AiAgentMemoryLoad') {
          const outputs = payload.outputs as
            Record<string, unknown> | undefined;
          const memCount = outputs?.message_count ?? 0;
          addSystem(
            `Loaded ${memCount} messages from memory${durationStr}`,
            createdAt
          );
        } else if (stepType === 'AiAgentToolCall') {
          // The codegen names tool-call sub-steps either "Tool: <name>"
          // (regular edge-tools) or `<agent>.tool.<toolName>.<counter>`
          // (MCP synthetic tools — `agent.tool.runtara_search.1` etc).
          // Fall back from the human label to the structured id so the
          // synthetic case shows the actual tool name rather than
          // "unknown".
          const toolLabel = extractToolLabel(payload, stepName);
          addSystem(`${toolLabel} completed${durationStr}`, createdAt);
        } else if (stepType === 'AiAgentMemorySave') {
          addSystem(`Memory saved${durationStr}`, createdAt);
        } else if (stepType === 'AiAgentLlmCall' || stepType === 'AiAgent') {
          addSystem(`${stepName ?? 'AI Agent'} done${durationStr}`, createdAt);
        } else {
          addSystem(
            `${stepName ?? stepType ?? 'Step'} completed${durationStr}`,
            createdAt
          );
        }
        continue;
      }

      // External input received (user responded to signal)
      if (subtype === 'external_input_received') {
        const responseData = payload.response ?? payload.data;
        messages.push({
          id: makeId(),
          role: 'user',
          content:
            typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData ?? 'Response sent'),
          timestamp: createdAt,
          events: [],
        });
        continue;
      }
    }

    // Message events (if the backend emits them as step events)
    if (eventType === 'message') {
      const content =
        payload?.content ?? (event as Record<string, unknown>).content;
      messages.push({
        id: makeId(),
        role: 'assistant',
        content: (content as string) ?? '',
        timestamp: createdAt,
        events: [],
      });
      continue;
    }
  }

  return messages;
}

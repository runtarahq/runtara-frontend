import { useCallback, useRef, useState } from 'react';
import { useChatInputs } from './useChatInputs';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import {
  sendConversationMessage,
  streamConversationEvents,
  type ConversationEvent,
  type ConversationMessage,
} from '@/features/workflows/queries/chat';
import { parseSSEStream } from '@/features/workflows/utils/sse';
import { InputSubmissionError } from '@/features/workflows/utils/input-submission';

/** How often a stream that keeps failing is asked for again before the chat
 * says so. */
const MAX_STREAM_FAILURES = 5;
const STREAM_RETRY_MS = 1000;

/**
 * What a run is doing, as the conversation relays it (`activity`): model and
 * tool calls and memory, each a line in the transcript.
 */
function handleActivity(body: Record<string, unknown>) {
  const store = useChatStore.getState();

  switch (body.type) {
    case 'memory_loaded': {
      const outputs = body.outputs as Record<string, unknown> | undefined;
      const count = body.message_count ?? outputs?.message_count ?? 0;
      store.addSystemMessage(`Loaded ${String(count)} messages from memory`);
      break;
    }

    case 'llm_start': {
      const model = body.model as string | undefined;
      store.addSystemMessage(model ? `${model} thinking...` : 'Thinking...');
      break;
    }

    case 'llm_end':
      store.addSystemMessage('Done thinking');
      break;

    case 'tool_call': {
      const toolName = (body.tool_name as string) ?? 'tool';
      store.addSystemMessage(`Calling tool: ${toolName}`);
      break;
    }

    case 'tool_result': {
      const toolName = (body.tool_name as string) ?? 'tool';
      const durationMs = body.duration_ms as number | undefined;
      const durationStr =
        durationMs != null ? ` (${String(durationMs)}ms)` : '';
      store.addSystemMessage(`${toolName} completed${durationStr}`);
      break;
    }

    case 'memory_saved': {
      const savedCount = body.message_count ?? 0;
      store.addSystemMessage(`Saved ${String(savedCount)} messages to memory`);
      break;
    }

    case 'message':
      // An AI Agent step's answer, before the run says or returns it.
      if (typeof body.content === 'string') say(body.content);
      break;
  }
}

/** Adds what the workflow said, unless it is what it just said: a run's
 * answer can arrive as its agent's message and again as its reply. */
function say(text: string) {
  if (!text.trim()) return;
  const store = useChatStore.getState();
  const last = [...store.messages].reverse().find((m) => m.role !== 'system');
  if (last?.role === 'assistant' && last.content === text) return;
  store.startAssistantMessage();
  store.appendToAssistantMessage(text);
  store.finalizeAssistantMessage();
}

/** What a reply carries, as text: its own, then its attachments. */
function replyText(body: Record<string, unknown>): string {
  const text = typeof body.text === 'string' ? body.text : '';
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as Record<string, unknown>[])
    : [];
  const links = attachments
    .filter((a) => typeof a.url === 'string')
    .map((a) => `[${String(a.name ?? a.url)}](${String(a.url)})`);
  return [text, ...links].filter(Boolean).join('\n');
}

/**
 * Applies one event of the conversation to the chat store. `sent` holds the
 * ids of the messages this page sent, which it has shown already.
 */
function handleConversationEvent(event: ConversationEvent, sent: Set<string>) {
  const store = useChatStore.getState();
  const body = event.body ?? {};
  const shown = typeof body.messageId === 'string' && sent.has(body.messageId);

  switch (event.kind) {
    case 'run_started':
      if (typeof body.instanceId === 'string')
        store.setInstanceId(body.instanceId);
      if (!shown && typeof body.text === 'string' && body.text)
        store.addUserMessage(body.text);
      store.addSystemMessage('Execution started');
      store.setStatus('streaming');
      break;

    case 'message_delivered':
      if (!shown && typeof body.text === 'string' && body.text)
        store.addUserMessage(body.text);
      store.setStatus('streaming');
      break;

    case 'activity':
      handleActivity(body);
      break;

    case 'reply':
      say(replyText(body));
      break;

    case 'waiting_for_input': {
      // Only a structured request is announced; a plain "message" one is the
      // chat's own input box. Managed discovery controls actionable forms.
      const schema = body.responseSchema as Record<string, unknown> | null;
      const keys =
        schema && typeof schema === 'object' ? Object.keys(schema) : [];
      const isSimple =
        keys.length === 0 || (keys.length === 1 && keys[0] === 'message');
      if (!isSimple)
        store.addSystemMessage(
          (body.message as string) ?? 'Waiting for input...'
        );
      break;
    }

    case 'message_failed':
      store.setError(
        (body.reason as string) ?? 'The message could not be delivered'
      );
      break;

    case 'run_ended':
      // One run of the conversation is over; the next message starts the
      // next one.
      if (body.status === 'completed') {
        store.setStatus(
          store.pendingInputs.length ? 'waiting_for_input' : 'idle'
        );
      } else {
        store.setError((body.error as string) ?? 'Execution failed');
        store.setStatus('error');
      }
      break;
  }
}

interface Unconfirmed {
  conversationKey: string;
  message: ConversationMessage & { text: string };
}

export function useChatStream(workflowId: string) {
  const { refreshPendingInput, submitInput, uncertainResponses } =
    useChatInputs(workflowId);
  const abortRef = useRef<AbortController | null>(null);
  // The ids of the messages this page sent, which it shows as it sends them
  // and so does not show again when the conversation reports them.
  const sent = useRef(new Set<string>());
  // Every message whose receipt is unconfirmed, each with the id a retry
  // reuses so the conversation takes it once.
  const unconfirmed = useRef<Unconfirmed[]>([]);
  const enqueueing = useRef(false);
  const [uncertainMessages, setUncertainMessages] = useState<
    { conversationKey: string; message: string }[]
  >([]);
  const settleUnconfirmed = useCallback(
    (update: (all: Unconfirmed[]) => Unconfirmed[]) => {
      unconfirmed.current = update(unconfirmed.current);
      setUncertainMessages(
        unconfirmed.current.map(({ conversationKey, message }) => ({
          conversationKey,
          message: message.text,
        }))
      );
    },
    []
  );

  /**
   * Reads the conversation's events from `from` on, for as long as this is
   * the page's stream. The server ends a stream after a while, and a
   * connection can drop: either way it is asked for again from the last
   * event seen, so nothing is missed or shown twice.
   */
  const follow = useCallback(
    async (key: string, from: number, abortController: AbortController) => {
      const store = useChatStore.getState();
      const isCurrent = () =>
        !abortController.signal.aborted && abortRef.current === abortController;
      let after = from;
      let failures = 0;

      while (isCurrent()) {
        try {
          const response = await streamConversationEvents(
            workflowId,
            key,
            after,
            abortController.signal
          );
          if (!response.body) {
            throw new Error('Response body is null — SSE stream unavailable');
          }
          for await (const parsed of parseSSEStream(
            response.body,
            abortController.signal
          )) {
            if (!isCurrent()) return;
            const event = parsed.data as unknown as ConversationEvent;
            if (typeof event.seq !== 'number' || event.seq <= after) continue;
            after = event.seq;
            failures = 0;
            handleConversationEvent(event, sent.current);
            if (
              event.kind === 'waiting_for_input' ||
              event.kind === 'run_started'
            )
              void refreshPendingInput();
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!isCurrent()) return;
          failures += 1;
          if (failures >= MAX_STREAM_FAILURES) {
            store.setError(
              err instanceof Error
                ? err.message
                : 'The conversation could not be read'
            );
            store.setStatus('error');
            return;
          }
        }
        if (isCurrent())
          await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_MS));
      }
    },
    [workflowId, refreshPendingInput]
  );

  /** Makes this the page's one stream, replacing any before it. */
  const begin = useCallback(() => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    const store = useChatStore.getState();
    store.setError(null);
    store.setAbortController(abortController);
    return abortController;
  }, []);

  /**
   * Start a new conversation under a key of this page's own, with a first
   * message that says nothing: the workflow begins, and speaks first if it
   * has something to say.
   */
  const startSession = useCallback(async () => {
    const store = useChatStore.getState();
    const abortController = begin();
    const key = `console:${crypto.randomUUID()}`;
    store.setConversationKey(key);
    store.setStatus('streaming');

    const opening: ConversationMessage = {
      id: crypto.randomUUID(),
      payload: {},
    };
    sent.current.add(opening.id);
    try {
      const started = await sendConversationMessage(
        workflowId,
        key,
        opening,
        abortController.signal
      );
      if (started.state === 'failed') {
        store.setError(started.detail ?? 'The workflow could not be started');
        store.setStatus('error');
        return;
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      store.setError(
        err instanceof Error ? err.message : 'Failed to start the conversation'
      );
      store.setStatus('error');
      return;
    }
    await follow(key, 0, abortController);
  }, [workflowId, begin, follow]);

  /**
   * Open a conversation that exists (e.g. after a page refresh): its events
   * from the first are its transcript, and the stream carries on from there.
   */
  const reconnect = useCallback(
    async (key: string) => {
      const store = useChatStore.getState();
      const abortController = begin();
      store.setConversationKey(key);
      await follow(key, 0, abortController);
    },
    [begin, follow]
  );

  /**
   * Send what the user typed. A run that waits for it is answered directly;
   * otherwise the message goes into the conversation, which starts a run
   * with it or holds it until its turn. The reply arrives on the stream.
   */
  const sendMessage = useCallback(
    async (content: string) => {
      const store = useChatStore.getState();
      const {
        conversationKey,
        waitingForInput,
        pendingInputs,
        pendingInputError,
      } = store;
      if (enqueueing.current) return false;
      const retry =
        unconfirmed.current.find(
          (intent) =>
            intent.conversationKey === conversationKey &&
            intent.message.text === content
        ) ?? null;
      if (
        !retry &&
        (pendingInputError || (pendingInputs.length > 1 && !waitingForInput))
      ) {
        store.setError(pendingInputError ?? 'Choose which request to answer.');
        return false;
      }
      if (!retry && waitingForInput) {
        const accepted = await submitInput(
          waitingForInput.requestId,
          {
            message: content,
          },
          waitingForInput.instanceId
        );
        if (accepted) store.addUserMessage(content);
        return accepted;
      }
      if (!conversationKey) {
        store.setError('No active conversation');
        return false;
      }
      const intent: Unconfirmed = retry ?? {
        conversationKey,
        message: { id: crypto.randomUUID(), text: content },
      };
      enqueueing.current = true;
      store.setError(null);
      // Before it is sent: the conversation may report it before the send
      // returns.
      sent.current.add(intent.message.id);
      try {
        const outcome = await sendConversationMessage(
          workflowId,
          conversationKey,
          intent.message
        );
        settleUnconfirmed((all) => all.filter((i) => i !== intent));
        const current = useChatStore.getState();
        if (current.conversationKey !== conversationKey) return false;
        store.addUserMessage(content);
        if (outcome.state === 'failed') {
          store.setError(
            outcome.detail ?? 'The message could not be delivered'
          );
          return true;
        }
        // Taken: it started a run, answered one, or waits its turn. Either
        // way a reply is on its way, on the stream.
        store.setStatus(
          current.pendingInputs.length ? 'waiting_for_input' : 'streaming'
        );
        return true;
      } catch (err: unknown) {
        const refused =
          err instanceof InputSubmissionError &&
          err.status !== undefined &&
          err.status < 500;
        if (refused) {
          // Definitive: the conversation kept nothing (its queue is full, or
          // the message is not one). Sending the same message again as it is
          // cannot help; a new one may.
          sent.current.delete(intent.message.id);
          settleUnconfirmed((all) => all.filter((i) => i !== intent));
        } else {
          settleUnconfirmed((all) =>
            all.includes(intent) ? all : [...all, intent]
          );
        }
        if (useChatStore.getState().conversationKey === conversationKey)
          store.setError(
            err instanceof Error ? err.message : 'Failed to send message'
          );
        return false;
      } finally {
        enqueueing.current = false;
      }
    },
    [workflowId, submitInput, settleUnconfirmed]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const store = useChatStore.getState();
    store.finalizeAssistantMessage();
    store.setAbortController(null);

    // Only change status if we were actively streaming
    if (store.status === 'streaming') {
      store.setStatus('idle');
    }
  }, []);

  return {
    startSession,
    reconnect,
    sendMessage,
    refreshPendingInput,
    submitInput,
    uncertainMessages,
    uncertainResponses,
    cancelStream,
  };
}

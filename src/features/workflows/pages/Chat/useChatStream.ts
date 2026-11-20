import { useCallback, useRef, useState } from 'react';
import { useChatInputs } from './useChatInputs';
import { useToken } from '@/shared/hooks/useToken';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import type { Message } from '@/generated/RuntaraRuntimeApi';
import {
  ConversationError,
  getConversation,
  readStream,
  sendMessage as sendConversationMessage,
  streamEvents,
} from '@/features/workflows/queries/conversations';

/** How often a stream that keeps failing is asked for again before the chat
 * says so. */
const MAX_STREAM_FAILURES = 5;
const STREAM_RETRY_MS = 1000;
/** A workspace that holds as many streams as it may is asked again later:
 * one frees when another chat is closed. */
const STREAMS_FULL_RETRY_MS = 15000;
const STREAMS_FULL = 'Too many open chats in this workspace';
const DELETED = 'This conversation was deleted';

interface Unconfirmed {
  conversationKey: string;
  message: Message & { text: string };
}

export function useChatStream(workflowId: string) {
  const token = useToken();
  const { refreshPendingInput, submitInput, uncertainResponses } =
    useChatInputs(workflowId, token);
  const abortRef = useRef<AbortController | null>(null);
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
      let retryIn = STREAM_RETRY_MS;

      while (isCurrent()) {
        retryIn = STREAM_RETRY_MS;
        try {
          const events = await streamEvents(token, workflowId, key, {
            after,
            signal: abortController.signal,
          });
          if (useChatStore.getState().error === STREAMS_FULL)
            store.setError(null);
          for await (const event of readStream(
            events,
            abortController.signal
          )) {
            if (!isCurrent()) return;
            if (event.kind === 'caught_up') {
              // What was kept has been read: the transcript is whole, and
              // what the chat is doing is read from the conversation as it
              // stands, not inferred from what was replayed.
              failures = 0;
              useChatStore.getState().setLoading(false);
              void getConversation(
                token,
                workflowId,
                key,
                abortController.signal
              )
                .then((state) => {
                  if (isCurrent())
                    useChatStore.getState().applyConversationState(state);
                })
                .catch(() => {
                  // The events still say what happens from here on.
                });
              continue;
            }
            // The pieces of a reply are not kept, and so not numbered.
            if (event.seq <= after) continue;
            after = event.seq;
            failures = 0;
            useChatStore.getState().applyConversationEvent(event);
            if (
              event.kind === 'waiting_for_input' ||
              event.kind === 'run_started'
            )
              void refreshPendingInput();
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!isCurrent()) return;
          const code = err instanceof ConversationError ? err.code : undefined;
          if (code === 'CONVERSATION_NOT_FOUND') {
            // Nothing to read on from: the chat is over.
            store.setLoading(false);
            store.setError(DELETED);
            store.setStatus('error');
            return;
          }
          if (code === 'CONVERSATION_STREAMS_FULL') {
            // Not a failure of this conversation, and not counted as one.
            store.setLoading(false);
            store.setError(STREAMS_FULL);
            retryIn = STREAMS_FULL_RETRY_MS;
          } else failures += 1;
          if (failures >= MAX_STREAM_FAILURES) {
            store.setLoading(false);
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
          await new Promise((resolve) => setTimeout(resolve, retryIn));
      }
    },
    [token, workflowId, refreshPendingInput]
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

    const opening: Message = {
      id: crypto.randomUUID(),
      payload: {},
    };
    try {
      const started = await sendConversationMessage(
        token,
        workflowId,
        key,
        opening,
        { signal: abortController.signal }
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
  }, [token, workflowId, begin, follow]);

  /**
   * Open a conversation that exists (e.g. after a page refresh): its events
   * from the first are its transcript, and the stream carries on from there.
   */
  const reconnect = useCallback(
    async (key: string) => {
      const store = useChatStore.getState();
      const abortController = begin();
      store.setConversationKey(key);
      store.setLoading(true);
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
      try {
        const outcome = await sendConversationMessage(
          token,
          workflowId,
          conversationKey,
          intent.message
        );
        settleUnconfirmed((all) => all.filter((i) => i !== intent));
        const current = useChatStore.getState();
        if (current.conversationKey !== conversationKey) return false;
        // The conversation may have reported it already: it is one line
        // either way.
        store.showSentMessage(intent.message.id, content);
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
          err instanceof ConversationError &&
          err.status !== undefined &&
          err.status < 500;
        if (refused) {
          // Definitive: the conversation kept nothing (its queue is full, or
          // the message is not one). Sending the same message again as it is
          // cannot help; a new one may.
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
    [token, workflowId, submitInput, settleUnconfirmed]
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

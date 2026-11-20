import { useCallback, useRef, useState } from 'react';
import { useChatInputs } from './useChatInputs';
import { getPendingInput } from '@/features/workflows/queries';
import { messageText } from '@/features/workflows/stores/conversation-log';
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
  message: Message;
  /** What the user is shown of it. */
  label: string;
}

/** The answer to a request that the server no longer waits on. */
const REQUEST_CLOSED = 'That request is no longer open';

export function useChatStream(workflowId: string) {
  const token = useToken();
  const {
    refreshPendingInput,
    submitInput: submitRunInput,
    uncertainResponses,
  } = useChatInputs(workflowId, token);
  const abortRef = useRef<AbortController | null>(null);
  // Every message whose receipt is unconfirmed, each with the id a retry
  // reuses so the conversation takes it once.
  const unconfirmed = useRef<Unconfirmed[]>([]);
  const enqueueing = useRef(false);
  const [uncertainMessages, setUncertainMessages] = useState<
    { conversationKey: string; id: string; message: string }[]
  >([]);
  const settleUnconfirmed = useCallback(
    (update: (all: Unconfirmed[]) => Unconfirmed[]) => {
      unconfirmed.current = update(unconfirmed.current);
      setUncertainMessages(
        unconfirmed.current.map(({ conversationKey, message, label }) => ({
          conversationKey,
          id: message.id,
          message: label,
        }))
      );
    },
    []
  );

  /**
   * The conversation announces the first thing its run waits for. A run
   * that waits on several at once (tools called together) has the others
   * only in its own pending inputs: they are read once, to be offered beside
   * the one announced.
   */
  const listOtherWaits = useCallback(
    async (key: string) => {
      const { instanceId, waitingForInput } = useChatStore.getState();
      if (!instanceId || !waitingForInput) return;
      try {
        const pending = await getPendingInput(token, workflowId, instanceId);
        const current = useChatStore.getState();
        if (
          current.conversationKey !== key ||
          current.instanceId !== instanceId ||
          !pending.some((p) => p.requestId === waitingForInput.requestId)
        )
          return;
        current.addPendingInputs(
          pending.map((request) => ({ ...request, instanceId }))
        );
      } catch {
        // The one the conversation announced can still be answered.
      }
    },
    [token, workflowId]
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
                  if (!isCurrent()) return;
                  useChatStore.getState().applyConversationState(state);
                  void listOtherWaits(key);
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
              event.kind === 'waiting_for_input' &&
              !useChatStore.getState().loading
            )
              void listOtherWaits(key);
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
    [token, workflowId, listOtherWaits]
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
   * Sends a message into the conversation: it starts a run, answers the
   * request it names, or waits its turn. What comes of it arrives on the
   * stream. A message whose receipt is unconfirmed is kept, to be sent
   * again under the same id.
   */
  const deliver = useCallback(
    async (intent: Unconfirmed): Promise<boolean> => {
      const store = useChatStore.getState();
      const { conversationKey, message, label } = intent;
      const answers = message.inReplyTo ?? undefined;
      if (enqueueing.current) return false;
      enqueueing.current = true;
      store.setError(null);
      try {
        const outcome = await sendConversationMessage(
          token,
          workflowId,
          conversationKey,
          message
        );
        settleUnconfirmed((all) => all.filter((i) => i !== intent));
        const current = useChatStore.getState();
        if (current.conversationKey !== conversationKey) return false;
        // The conversation may have reported it already: it is one line
        // either way.
        current.showSentMessage(message.id, label, answers);
        if (outcome.state === 'failed') {
          current.setMessageFailure(
            message.id,
            outcome.detail ?? 'The message could not be delivered'
          );
          if (!answers) return true;
          // An answer fails when it does not fit the request, which then
          // stays open, or when the request is gone. The conversation says
          // which; the answer is never sent to another request.
          const state = await getConversation(
            token,
            workflowId,
            conversationKey
          ).catch(() => null);
          const now = useChatStore.getState();
          if (state && now.conversationKey === conversationKey) {
            now.applyConversationState(state);
            const waiting = state.waitingFor as
              { requestId?: string } | null | undefined;
            if (waiting?.requestId !== answers) {
              now.closePendingInput(answers);
              now.setMessageFailure(message.id, REQUEST_CLOSED);
            } else void listOtherWaits(conversationKey);
          }
          // What was typed is in the transcript; a form keeps its values.
          return !message.payload;
        }
        if (answers) {
          current.closePendingInput(answers);
          return true;
        }
        // Taken: it started a run or waits its turn. Either way a reply is
        // on its way, on the stream.
        current.setStatus(
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
    [token, workflowId, settleUnconfirmed, listOtherWaits]
  );

  /**
   * Send what the user typed. While the run waits it is the answer to that
   * request (`inReplyTo`), and is in the conversation's log like any other
   * message. A run that no conversation started is answered directly.
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
      if (!conversationKey) {
        if (!waitingForInput) {
          store.setError('No active conversation');
          return false;
        }
        const accepted = await submitRunInput(
          waitingForInput.requestId,
          { message: content },
          waitingForInput.instanceId
        );
        if (accepted) store.addUserMessage(content);
        return accepted;
      }
      return deliver(
        retry ?? {
          conversationKey,
          label: content,
          message: {
            id: crypto.randomUUID(),
            text: content,
            ...(waitingForInput
              ? { inReplyTo: waitingForInput.requestId }
              : {}),
          },
        }
      );
    },
    [submitRunInput, deliver]
  );

  /**
   * Answer a request with a form's values: a message whose payload is used
   * as it is. `summary` is what a run that no conversation started shows of
   * it, since nothing logs that answer.
   */
  const submitInput = useCallback(
    async (
      requestId: string,
      payload: Record<string, unknown>,
      instanceId?: string,
      summary?: string
    ) => {
      const store = useChatStore.getState();
      const { conversationKey } = store;
      if (!conversationKey) {
        const accepted = await submitRunInput(requestId, payload, instanceId);
        if (accepted && summary) store.addUserMessage(summary);
        return accepted;
      }
      const body = JSON.stringify(payload);
      const retry = unconfirmed.current.find(
        (intent) =>
          intent.conversationKey === conversationKey &&
          intent.message.inReplyTo === requestId &&
          JSON.stringify(intent.message.payload) === body
      );
      return deliver(
        retry ?? {
          conversationKey,
          label: messageText({ payload }),
          message: { id: crypto.randomUUID(), payload, inReplyTo: requestId },
        }
      );
    },
    [submitRunInput, deliver]
  );

  /** Send an unconfirmed message again, under the id it had. */
  const retryMessage = useCallback(
    async (messageId: string) => {
      const intent = unconfirmed.current.find(
        (i) => i.message.id === messageId
      );
      return intent ? deliver(intent) : false;
    },
    [deliver]
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
    retryMessage,
    /** Sends an unconfirmed answer to a run again, as the same operation. */
    retryResponse: submitRunInput,
    uncertainMessages,
    uncertainResponses,
    cancelStream,
  };
}

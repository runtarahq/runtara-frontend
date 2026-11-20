import { useCallback, useRef, useState } from 'react';
import { useChatInputs } from './useChatInputs';
import { getPendingInput } from '@/features/workflows/queries';
import { messageText } from '@/features/workflows/stores/conversation-log';
import { useToken } from '@/shared/hooks/useToken';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import type { Message, ReplyDelta } from '@/generated/RuntaraRuntimeApi';
import {
  ConversationError,
  getConversation,
  openConversation,
  readBack,
  readStream,
  sendMessage as sendConversationMessage,
  stopConversation,
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
const QUEUE_FULL = 'Too many messages waiting; wait for a reply';
/** What the console keeps about a conversation it opened. It is handed to
 * every run, so it is kept small. */
const CONSOLE_METADATA = { source: 'console' };
const TITLE_LENGTH = 60;
/** How many kept events a conversation is opened with, and how many more
 * each reading back adds. */
const PAGE = 200;

/** A title for a conversation, from the first thing said in it. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\s*\n/)[0].replace(/\s+/g, ' ');
  return line.length > TITLE_LENGTH
    ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
    : line;
}

interface Unconfirmed {
  conversationKey: string;
  message: Message;
  /** What the user is shown of it. */
  label: string;
}

/** The answer to a request that the server no longer waits on. */
const REQUEST_CLOSED = 'That request is no longer open';

/** What a chat may do beside its conversation's own routes. */
interface ChatOptions {
  /**
   * The chat holds a conversation token, not a session: it may read the
   * conversation's state and events, send messages and stop, and nothing
   * else. It does not name the conversation or read a run's pending inputs,
   * and a refused token ends it.
   */
  restricted?: boolean;
}

const NO_ACCESS = 'This link has expired or is not valid';
/**
 * What the holder of a conversation token is shown: what is said, and what
 * the chat needs to know of its runs. Not what the runs did (`activity`:
 * model calls, tool calls, memory), which is the workspace's to see.
 */
const SAID = [
  'message',
  'reply',
  'reply_delta',
  'waiting_for_input',
  'message_delivered',
  'message_failed',
  'run_started',
  'run_ended',
];

/** The signed-in console's chat with a workflow. */
export function useChatStream(workflowId: string) {
  return useConversationChat(workflowId, useToken());
}

/**
 * A chat with a workflow through its conversation, as whoever `token` says:
 * a signed-in user, or the holder of a conversation token.
 */
export function useConversationChat(
  workflowId: string,
  token: string,
  { restricted = false }: ChatOptions = {}
) {
  // Every kind for the console; only what is said for a token's holder.
  const kinds = restricted ? SAID : undefined;
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

  /** Reads the conversation as it stands: how many messages wait their
   * turn, which run carries it and what that run waits for. */
  const readState = useCallback(
    async (key: string, signal?: AbortSignal) => {
      try {
        const state = await getConversation(token, workflowId, key, signal);
        const current = useChatStore.getState();
        if (current.conversationKey === key)
          current.applyConversationState(state);
      } catch {
        // The events still say what happens from here on.
      }
    },
    [token, workflowId]
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
      // A conversation token does not read a run.
      if (restricted || !instanceId || !waitingForInput) return;
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
    [token, workflowId, restricted]
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
      // The pieces of replies arrive many times a second. They are applied
      // together, once a frame, so a long answer does not render the
      // transcript once a piece.
      let pieces: ReplyDelta[] = [];
      let frame: number | null = null;
      const applyPieces = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        if (!pieces.length) return;
        const batch = pieces;
        pieces = [];
        if (isCurrent()) useChatStore.getState().applyReplyPieces(batch);
      };
      let retryIn = STREAM_RETRY_MS;

      while (isCurrent()) {
        retryIn = STREAM_RETRY_MS;
        try {
          const events = await streamEvents(token, workflowId, key, {
            after,
            kinds,
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
              void readState(key, abortController.signal).then(() => {
                if (isCurrent()) void listOtherWaits(key);
              });
              continue;
            }
            if (event.kind === 'reply_delta') {
              // Not kept, and so not numbered (`seq` 0): read before the
              // check below, which they must neither pass nor move.
              pieces.push(event.body);
              frame ??= requestAnimationFrame(applyPieces);
              continue;
            }
            if (event.seq <= after) continue;
            // In the order they were said: a reply follows its pieces.
            applyPieces();
            after = event.seq;
            failures = 0;
            useChatStore.getState().applyConversationEvent(event);
            const live = !useChatStore.getState().loading;
            if (event.kind === 'waiting_for_input' && live)
              void listOtherWaits(key);
            // A run began or ended while messages waited: how many still
            // do is the conversation's to say.
            if (
              live &&
              (event.kind === 'run_started' || event.kind === 'run_ended') &&
              useChatStore.getState().queued > 0
            )
              void readState(key, abortController.signal);
          }
        } catch (err: unknown) {
          applyPieces();
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (!isCurrent()) return;
          const code = err instanceof ConversationError ? err.code : undefined;
          const status =
            err instanceof ConversationError ? err.status : undefined;
          if (restricted && (status === 401 || status === 403)) {
            // The token is no longer taken: asking again cannot help.
            store.setLoading(false);
            store.setError(NO_ACCESS);
            store.setStatus('error');
            return;
          }
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
    [token, workflowId, listOtherWaits, readState, restricted, kinds]
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
   * Start a new conversation under a key of this page's own. It is opened
   * as the console's, and `onOpened` is told its key once it exists. Then a
   * first message that says nothing is sent: the workflow begins, and
   * speaks first if it has something to say.
   */
  const startSession = useCallback(
    async (onOpened?: (key: string) => void) => {
      const store = useChatStore.getState();
      const abortController = begin();
      const key = `console:${crypto.randomUUID()}`;
      store.setConversationKey(key);
      store.setStatus('streaming');
      try {
        const opened = await openConversation(
          token,
          workflowId,
          key,
          { metadata: CONSOLE_METADATA },
          abortController.signal
        );
        if (abortRef.current !== abortController) return;
        store.setTitle(opened.title ?? null);
        onOpened?.(key);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        store.setError(
          err instanceof Error
            ? err.message
            : 'Failed to start the conversation'
        );
        store.setStatus('error');
        return;
      }

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
          err instanceof Error
            ? err.message
            : 'Failed to start the conversation'
        );
        store.setStatus('error');
        return;
      }
      await follow(key, 0, abortController);
    },
    [token, workflowId, begin, follow]
  );

  /**
   * Open a conversation that exists (e.g. after a page refresh). Its last
   * events are read back and are its transcript, and the stream carries on
   * from the last of them: a long conversation is not replayed whole. What
   * is before them is read when asked for (`loadEarlier`).
   */
  const reconnect = useCallback(
    async (key: string) => {
      const store = useChatStore.getState();
      const abortController = begin();
      store.setConversationKey(key);
      store.setLoading(true);
      let from = 0;
      try {
        const newestFirst = await readBack(
          token,
          workflowId,
          key,
          { limit: PAGE, kinds },
          abortController.signal
        );
        if (abortRef.current !== abortController) return;
        const events = [...newestFirst].reverse();
        store.openConversationEvents(
          events,
          newestFirst.length >= PAGE,
          !kinds
        );
        from = events.at(-1)?.seq ?? 0;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (abortRef.current !== abortController) return;
        if (
          err instanceof ConversationError &&
          err.code === 'CONVERSATION_NOT_FOUND'
        ) {
          store.setLoading(false);
          store.setError(DELETED);
          store.setStatus('error');
          return;
        }
        // Not read back: the stream sends what is kept, from the first.
      }
      await follow(key, from, abortController);
    },
    [token, workflowId, begin, follow, kinds]
  );

  /** Read the events before the earliest one shown, and show them above. */
  const loadEarlier = useCallback(async () => {
    const store = useChatStore.getState();
    const { conversationKey, firstSeq, hasEarlier, loadingEarlier } = store;
    if (!conversationKey || !hasEarlier || loadingEarlier || firstSeq <= 1)
      return;
    store.setLoadingEarlier(true);
    try {
      const newestFirst = await readBack(token, workflowId, conversationKey, {
        before: firstSeq,
        limit: PAGE,
        kinds,
      });
      const current = useChatStore.getState();
      if (current.conversationKey !== conversationKey) return;
      current.prependConversationEvents(
        [...newestFirst].reverse(),
        newestFirst.length >= PAGE,
        !kinds
      );
    } catch (err: unknown) {
      if (useChatStore.getState().conversationKey === conversationKey)
        store.setError(
          err instanceof Error
            ? err.message
            : 'Earlier messages could not be read'
        );
    } finally {
      if (useChatStore.getState().conversationKey === conversationKey)
        useChatStore.getState().setLoadingEarlier(false);
    }
  }, [token, workflowId, kinds]);

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
        // A conversation no one has named is called by the first thing said
        // in it. A title a person gave is never replaced.
        if (!restricted && current.title === null && message.text) {
          const title = titleFrom(message.text);
          current.setTitle(title);
          void openConversation(token, workflowId, conversationKey, {
            title,
          }).catch(() => {
            const now = useChatStore.getState();
            if (now.conversationKey === conversationKey && now.title === title)
              now.setTitle(null);
          });
        }
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
        if (outcome.state === 'queued') {
          current.setMessageQueued(message.id);
          void readState(conversationKey);
        }
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
            err instanceof ConversationError &&
              err.code === 'CONVERSATION_QUEUE_FULL'
              ? QUEUE_FULL
              : err instanceof Error
                ? err.message
                : 'Failed to send message'
          );
        return false;
      } finally {
        enqueueing.current = false;
      }
    },
    [
      token,
      workflowId,
      settleUnconfirmed,
      listOtherWaits,
      readState,
      restricted,
    ]
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

  /**
   * Stop the run that carries the conversation. The messages waiting their
   * turn keep it, unless `clearQueue` drops them too. The conversation says
   * when the run has stopped (`run_ended`).
   */
  const stop = useCallback(
    async (clearQueue = false) => {
      const store = useChatStore.getState();
      const { conversationKey } = store;
      if (!conversationKey) return;
      store.setError(null);
      try {
        await stopConversation(token, workflowId, conversationKey, {
          clearQueue,
        });
        if (clearQueue) void readState(conversationKey);
      } catch (err: unknown) {
        if (useChatStore.getState().conversationKey === conversationKey)
          store.setError(
            err instanceof Error ? err.message : 'The run could not be stopped'
          );
      }
    },
    [token, workflowId, readState]
  );

  /** Stops reading the conversation. The run is left to go on: leaving the
   * page is not stopping it. */
  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const store = useChatStore.getState();
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
    loadEarlier,
    stop,
    /** Sends an unconfirmed answer to a run again, as the same operation. */
    retryResponse: submitRunInput,
    uncertainMessages,
    uncertainResponses,
    cancelStream,
  };
}

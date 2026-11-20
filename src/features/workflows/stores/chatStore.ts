import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  ConversationEvent,
  ConversationState,
  ReplyDelta,
} from '@/generated/RuntaraRuntimeApi';
import {
  applyEvent,
  applyPieces,
  applyState,
  closeRequest,
  messageLineId,
} from './conversation-log';
import {
  ChatMessage,
  ChatSSEEvent,
  ChatStatus,
  WaitingForInputData,
} from '@/features/workflows/types/chat';

interface ChatStoreState {
  // Core state
  workflowId: string | null;
  workflowName: string | null;
  instanceId: string | null;
  /** The client's name for the conversation with the workflow. */
  conversationKey: string | null;
  messages: ChatMessage[];
  status: ChatStatus;
  /** Whether a conversation's kept events are still being read. */
  loading: boolean;
  /** The last kept event of the conversation applied. */
  lastSeq: number;
  /** How many messages wait their turn in the conversation. */
  queued: number;
  waitingForInput: WaitingForInputData | null;
  pendingInputs: WaitingForInputData[];
  pendingInputError: string | null;
  error: string | null;

  // Stream management (not serialized by immer — stored as plain ref)
  abortController: AbortController | null;

  // Actions
  initChat: (workflowId: string, workflowName: string) => void;
  resumeChat: (
    workflowId: string,
    workflowName: string,
    instanceId: string
  ) => void;
  addUserMessage: (content: string) => void;
  /** Shows a message this page sent. The conversation's `message` event
   * for the same id is the same line, whichever comes first. */
  showSentMessage: (
    messageId: string,
    content: string,
    answers?: string
  ) => void;
  /** A message this page sent waits its turn. */
  setMessageQueued: (messageId: string) => void;
  /** Says of a message this page sent why it was not taken. */
  setMessageFailure: (messageId: string, failure: string) => void;
  /** Applies one kept event of the conversation's log. */
  applyConversationEvent: (event: ConversationEvent) => void;
  /** Applies pieces of replies as they are written, several at once. */
  applyReplyPieces: (pieces: ReplyDelta[]) => void;
  /** Applies the conversation as it stands, read once it has caught up. */
  applyConversationState: (state: ConversationState) => void;
  setLoading: (loading: boolean) => void;
  addSystemMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendToAssistantMessage: (content: string) => void;
  addEventToAssistantMessage: (event: ChatSSEEvent) => void;
  finalizeAssistantMessage: () => void;
  setStatus: (status: ChatStatus) => void;
  setInstanceId: (instanceId: string) => void;
  setConversationKey: (key: string | null) => void;
  setPendingInputs: (data: WaitingForInputData[]) => void;
  /** Adds requests the run also waits on, beside the one announced. */
  addPendingInputs: (data: WaitingForInputData[]) => void;
  /** A request was answered, or is gone: it is no longer offered. */
  closePendingInput: (requestId: string) => void;
  setPendingInputError: (error: string | null) => void;
  setWaitingForInput: (data: WaitingForInputData | null) => void;
  setError: (error: string | null) => void;
  setAbortController: (controller: AbortController | null) => void;
  loadHistory: (messages: ChatMessage[]) => void;
  resetChat: () => void;
}

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `msg_${Date.now()}_${idCounter}`;
}

export const useChatStore = create<ChatStoreState>()(
  devtools(
    immer((set) => ({
      // Initial state
      workflowId: null,
      workflowName: null,
      instanceId: null,
      conversationKey: null,
      messages: [],
      status: 'idle' as ChatStatus,
      loading: false,
      lastSeq: 0,
      queued: 0,
      waitingForInput: null,
      pendingInputs: [],
      pendingInputError: null,
      error: null,
      abortController: null,

      // Actions
      initChat: (workflowId, workflowName) => {
        set((state) => {
          state.workflowId = workflowId;
          state.workflowName = workflowName;
          state.instanceId = null;
          state.conversationKey = null;
          state.messages = [];
          state.status = 'idle';
          state.loading = false;
          state.lastSeq = 0;
          state.queued = 0;
          state.waitingForInput = null;
          state.pendingInputs = [];
          state.pendingInputError = null;
          state.error = null;
          state.abortController = null;
        });
      },

      resumeChat: (workflowId, workflowName, instanceId) => {
        set((state) => {
          state.workflowId = workflowId;
          state.workflowName = workflowName;
          state.instanceId = instanceId;
          state.conversationKey = null;
          state.messages = [];
          state.status = 'idle';
          state.loading = false;
          state.lastSeq = 0;
          state.queued = 0;
          state.waitingForInput = null;
          state.pendingInputs = [];
          state.pendingInputError = null;
          state.error = null;
          state.abortController = null;
        });
      },

      addUserMessage: (content) => {
        set((state) => {
          state.messages.push({
            id: generateId(),
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            events: [],
          });
        });
      },

      showSentMessage: (messageId, content, answers) => {
        set((state) => {
          const id = messageLineId(messageId);
          if (!content || state.messages.some((m) => m.id === id)) return;
          state.messages.push({
            id,
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            events: [],
            turn: messageId,
            ...(answers ? { answers } : {}),
          });
        });
      },

      setMessageQueued: (messageId) => {
        set((state) => {
          const line = state.messages.find(
            (m) => m.id === messageLineId(messageId)
          );
          if (line) line.queued = true;
        });
      },

      setMessageFailure: (messageId, failure) => {
        set((state) => {
          const line = state.messages.find(
            (m) => m.id === messageLineId(messageId)
          );
          if (line) line.failure = failure;
        });
      },

      applyConversationEvent: (event) => {
        set((state) => {
          applyEvent(state, event);
        });
      },

      applyReplyPieces: (pieces) => {
        set((state) => {
          applyPieces(state, pieces);
        });
      },

      applyConversationState: (conversation) => {
        set((state) => {
          applyState(state, conversation);
        });
      },

      setLoading: (loading) => {
        set((state) => {
          state.loading = loading;
        });
      },

      addSystemMessage: (content) => {
        set((state) => {
          state.messages.push({
            id: generateId(),
            role: 'system',
            content,
            timestamp: new Date().toISOString(),
            events: [],
          });
        });
      },

      startAssistantMessage: () => {
        set((state) => {
          state.messages.push({
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            events: [],
            isStreaming: true,
          });
        });
      },

      appendToAssistantMessage: (content) => {
        set((state) => {
          // Search backwards — system messages (memory_loaded etc.) may appear after the assistant placeholder
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].role === 'assistant') {
              state.messages[i].content += content;
              break;
            }
          }
        });
      },

      addEventToAssistantMessage: (event) => {
        set((state) => {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].role === 'assistant') {
              state.messages[i].events.push(event);
              break;
            }
          }
        });
      },

      finalizeAssistantMessage: () => {
        set((state) => {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].role === 'assistant') {
              state.messages[i].isStreaming = false;
              break;
            }
          }
        });
      },

      setStatus: (status) => {
        set((state) => {
          state.status = status;
        });
      },

      setInstanceId: (instanceId) => {
        set((state) => {
          if (state.instanceId !== instanceId) {
            state.pendingInputs = [];
            state.waitingForInput = null;
            state.pendingInputError = null;
          }
          state.instanceId = instanceId;
        });
      },

      setConversationKey: (key) => {
        set((state) => {
          if (state.conversationKey !== key) {
            state.lastSeq = 0;
            state.queued = 0;
            state.pendingInputs = [];
            state.waitingForInput = null;
            state.pendingInputError = null;
          }
          state.conversationKey = key;
        });
      },

      setPendingInputs: (data) => {
        set((state) => {
          // Request metadata is immutable. Keep existing objects/form drafts on refresh.
          state.pendingInputs = data.map(
            (request) =>
              state.pendingInputs.find(
                (existing) =>
                  existing.requestId === request.requestId &&
                  existing.instanceId === request.instanceId
              ) ?? request
          );
          state.waitingForInput =
            state.pendingInputs.find(
              (request) =>
                request.requestId === state.waitingForInput?.requestId &&
                request.instanceId === state.waitingForInput?.instanceId
            ) ??
            (state.pendingInputs.length === 1 ? state.pendingInputs[0] : null);
          state.pendingInputError = null;
          if (data.length > 0) state.status = 'waiting_for_input';
          else if (state.status === 'waiting_for_input') state.status = 'idle';
        });
      },

      addPendingInputs: (data) => {
        set((state) => {
          for (const request of data) {
            if (
              !state.pendingInputs.some(
                (existing) => existing.requestId === request.requestId
              )
            )
              state.pendingInputs.push(request);
          }
        });
      },

      closePendingInput: (requestId) => {
        set((state) => {
          closeRequest(state, requestId);
          if (state.status === 'waiting_for_input')
            state.status = state.pendingInputs.length
              ? 'waiting_for_input'
              : 'streaming';
        });
      },

      setPendingInputError: (error) => {
        set((state) => {
          state.pendingInputError = error;
        });
      },

      setWaitingForInput: (data) => {
        set((state) => {
          state.waitingForInput = data;
        });
      },

      setError: (error) => {
        set((state) => {
          state.error = error;
        });
      },

      setAbortController: (controller) => {
        set((state) => {
          state.abortController = controller;
        });
      },

      loadHistory: (messages) => {
        set((state) => {
          state.messages = messages;
        });
      },

      resetChat: () => {
        set((state) => {
          // Abort any in-flight stream
          state.abortController?.abort();
          state.workflowId = null;
          state.workflowName = null;
          state.instanceId = null;
          state.conversationKey = null;
          state.messages = [];
          state.status = 'idle';
          state.loading = false;
          state.lastSeq = 0;
          state.queued = 0;
          state.waitingForInput = null;
          state.pendingInputs = [];
          state.pendingInputError = null;
          state.error = null;
          state.abortController = null;
        });
      },
    })),
    { name: 'chat-store' }
  )
);

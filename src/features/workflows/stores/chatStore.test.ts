import { describe, it, expect, beforeEach } from 'vitest';
import type { ChatMessage } from '@/features/workflows/types/chat';
import { useChatStore } from './chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.getState().resetChat();
  });

  describe('initChat', () => {
    it('sets workflowId and workflowName, resets messages', () => {
      useChatStore.getState().addUserMessage('old message');
      useChatStore.getState().initChat('scen-1', 'My Workflow');

      const state = useChatStore.getState();
      expect(state.workflowId).toBe('scen-1');
      expect(state.workflowName).toBe('My Workflow');
      expect(state.messages).toHaveLength(0);
      expect(state.status).toBe('idle');
      expect(state.instanceId).toBeNull();
    });
  });

  describe('resumeChat', () => {
    it('sets workflowId, workflowName, and instanceId', () => {
      useChatStore.getState().resumeChat('scen-1', 'My Workflow', 'inst-1');

      const state = useChatStore.getState();
      expect(state.workflowId).toBe('scen-1');
      expect(state.instanceId).toBe('inst-1');
      expect(state.messages).toHaveLength(0);
    });
  });

  describe('addUserMessage', () => {
    it('adds a message with role user', () => {
      useChatStore.getState().addUserMessage('Hello');

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe('user');
      expect(state.messages[0].content).toBe('Hello');
      expect(state.messages[0].id).toBeTruthy();
    });
  });

  describe('setWaitingForInput', () => {
    it('sets and clears waiting for input data', () => {
      const store = useChatStore.getState();

      store.setWaitingForInput({
        requestId: 'req-1',
        signalId: 'sig-1',
        message: 'What product?',
        toolName: 'ask_user',
      });

      let state = useChatStore.getState();
      expect(state.waitingForInput).toEqual({
        requestId: 'req-1',
        signalId: 'sig-1',
        message: 'What product?',
        toolName: 'ask_user',
      });

      store.setWaitingForInput(null);
      state = useChatStore.getState();
      expect(state.waitingForInput).toBeNull();
    });
  });

  it('clears pending selection and discovery failure when the conversation changes', () => {
    const store = useChatStore.getState();
    store.setConversationKey('first');
    store.setPendingInputs([{ requestId: 'request', signalId: 'signal' }]);
    store.setPendingInputError('Unavailable');
    store.setConversationKey('second');
    expect(useChatStore.getState().pendingInputs).toEqual([]);
    expect(useChatStore.getState().waitingForInput).toBeNull();
    expect(useChatStore.getState().pendingInputError).toBeNull();
  });

  describe('loadHistory', () => {
    it('replaces all messages', () => {
      const store = useChatStore.getState();
      store.addUserMessage('old');

      const history: ChatMessage[] = [
        {
          id: 'h1',
          role: 'user',
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'h2',
          role: 'assistant',
          content: 'Hi there!',
          timestamp: new Date().toISOString(),
        },
      ];

      store.loadHistory(history);

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('h1');
      expect(state.messages[1].id).toBe('h2');
    });
  });

  describe('setStatus', () => {
    it('updates status', () => {
      useChatStore.getState().setStatus('streaming');
      expect(useChatStore.getState().status).toBe('streaming');

      useChatStore.getState().setStatus('streaming');
      expect(useChatStore.getState().status).toBe('streaming');
    });
  });

  describe('setError', () => {
    it('sets and clears error', () => {
      useChatStore.getState().setError('Something broke');
      expect(useChatStore.getState().error).toBe('Something broke');

      useChatStore.getState().setError(null);
      expect(useChatStore.getState().error).toBeNull();
    });
  });

  describe('resetChat', () => {
    it('resets all state to initial values', () => {
      const store = useChatStore.getState();
      store.resumeChat('scen-1', 'Test', 'inst-1');
      store.addUserMessage('hello');
      store.setStatus('streaming');
      store.setError('oops');
      store.setWaitingForInput({ requestId: 'req-1', signalId: 'sig-1' });

      store.resetChat();

      const state = useChatStore.getState();
      expect(state.workflowId).toBeNull();
      expect(state.workflowName).toBeNull();
      expect(state.instanceId).toBeNull();
      expect(state.messages).toHaveLength(0);
      expect(state.status).toBe('idle');
      expect(state.waitingForInput).toBeNull();
      expect(state.error).toBeNull();
    });
  });
});

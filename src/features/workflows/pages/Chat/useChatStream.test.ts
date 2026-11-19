import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatStream } from './useChatStream';
import { useChatStore } from '../../stores/chatStore';
import {
  sendConversationMessage,
  streamConversationEvents,
} from '../../queries/chat';
import { InputSubmissionError } from '../../utils/input-submission';

const submitInput = vi.hoisted(() => vi.fn());
vi.mock('./useChatInputs', () => ({
  useChatInputs: () => ({ refreshPendingInput: vi.fn(), submitInput }),
}));
vi.mock('../../queries/chat', () => ({
  sendConversationMessage: vi.fn(),
  streamConversationEvents: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.getState().resetChat();
  useChatStore.getState().resumeChat('workflow', 'Workflow', 'instance');
  useChatStore.getState().setConversationKey('conversation');
});
afterEach(cleanup);

const sentMessage = (call: number) =>
  vi.mocked(sendConversationMessage).mock.calls[call][2];
const queued = (messageId: string) => ({
  messageId,
  state: 'queued' as const,
  duplicate: false,
});

/** A stream the test writes conversation events to. */
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  let seq = 0;
  return {
    response: new Response(body),
    push(kind: string, eventBody: Record<string, unknown>, at?: number) {
      seq = at ?? seq + 1;
      const event = { seq, kind, body: eventBody, createdAt: 'now' };
      controller.enqueue(
        encoder.encode(
          `id: ${String(seq)}\nevent: ${kind}\ndata: ${JSON.stringify(event)}\n\n`
        )
      );
    },
    end: () => controller.close(),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const transcript = () =>
  useChatStore
    .getState()
    .messages.filter((m) => m.role !== 'system')
    .map((m) => [m.role, m.content]);

it('retries an unconfirmed message under its own id before newly discovered inputs, and gives a new message a new id', async () => {
  const { result } = renderHook(() => useChatStream('workflow'));
  vi.mocked(sendConversationMessage).mockRejectedValueOnce(
    new TypeError('lost acknowledgement')
  );
  await act(async () =>
    expect(await result.current.sendMessage('Hello')).toBe(false)
  );
  const original = sentMessage(0);
  expect(result.current.uncertainMessages).toEqual([
    { conversationKey: 'conversation', message: 'Hello' },
  ]);
  useChatStore
    .getState()
    .setPendingInputs([{ requestId: 'wait', signalId: 'signal' }]);
  vi.mocked(sendConversationMessage).mockResolvedValue(queued(original.id));
  await act(async () =>
    expect(await result.current.sendMessage('Hello')).toBe(true)
  );
  expect(sentMessage(1)).toEqual(original);
  expect(submitInput).not.toHaveBeenCalled();
  expect(result.current.uncertainMessages).toEqual([]);
  useChatStore.getState().setPendingInputs([]);
  await act(() => result.current.sendMessage('Hello'));
  expect(sentMessage(2).id).not.toBe(original.id);
});

it("does not duplicate an in-flight send or put an old conversation's error into a new one", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(sendConversationMessage).mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  const { result } = renderHook(() => useChatStream('workflow'));
  const first = result.current.sendMessage('Hello');
  expect(await result.current.sendMessage('Hello')).toBe(false);
  expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  useChatStore.getState().setConversationKey('replacement');
  await act(async () => {
    reject(new Error('Old conversation failed'));
    await first;
  });
  expect(useChatStore.getState().error).toBeNull();
});

it('treats a refused message as final: nothing kept, nothing to retry', async () => {
  const { result } = renderHook(() => useChatStream('workflow'));
  vi.mocked(sendConversationMessage).mockRejectedValueOnce(
    new InputSubmissionError(
      'the conversation already holds 32 messages waiting their turn',
      'CONVERSATION_QUEUE_FULL',
      429
    )
  );
  await act(async () =>
    expect(await result.current.sendMessage('Hello')).toBe(false)
  );
  expect(result.current.uncertainMessages).toEqual([]);
  expect(useChatStore.getState().error).toBe(
    'the conversation already holds 32 messages waiting their turn'
  );
  vi.mocked(sendConversationMessage).mockRejectedValueOnce(
    new TypeError('lost')
  );
  await act(() => result.current.sendMessage('Hello'));
  // A fresh message, not a replay of the refused one.
  expect(sentMessage(1).id).not.toBe(sentMessage(0).id);
});

it('says so when the message was taken but no run could be started for it', async () => {
  const { result } = renderHook(() => useChatStream('workflow'));
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_workflow, _key, message) => ({
      messageId: message.id,
      state: 'failed',
      detail: 'Workflow not found',
      duplicate: false,
    })
  );
  await act(() => result.current.sendMessage('Hello'));
  expect(useChatStore.getState().error).toBe('Workflow not found');
  expect(result.current.uncertainMessages).toEqual([]);
});

it("reads a conversation's events as its transcript, both sides of it", async () => {
  const events = stream();
  vi.mocked(streamConversationEvents).mockResolvedValue(events.response);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    events.push('run_started', {
      instanceId: 'run-1',
      messageId: 'theirs',
      text: 'Hello',
    });
    events.push('activity', { type: 'tool_call', tool_name: 'lookup' });
    events.push('reply', { text: 'Working on it.' });
    events.push('waiting_for_input', {
      requestId: 'r',
      message: 'What next?',
      responseSchema: { message: { type: 'string' } },
    });
    events.push('message_delivered', { messageId: 'theirs-2', text: 'This' });
    // An AI Agent step's answer, and the same text as the run's reply.
    events.push('activity', { type: 'message', content: 'Done.' });
    events.push('reply', { text: 'Done.' });
    events.push('run_ended', { instanceId: 'run-1', status: 'completed' });
    await settle();
  });
  expect(transcript()).toEqual([
    ['user', 'Hello'],
    ['assistant', 'Working on it.'],
    ['user', 'This'],
    ['assistant', 'Done.'],
  ]);
  expect(useChatStore.getState().instanceId).toBe('run-1');
  expect(useChatStore.getState().status).toBe('idle');
  expect(
    useChatStore.getState().messages.some((m) => m.content.includes('lookup'))
  ).toBe(true);
});

it('does not show a message it sent again when the conversation reports it', async () => {
  const events = stream();
  vi.mocked(streamConversationEvents).mockResolvedValue(events.response);
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_workflow, _key, message) => ({
      messageId: message.id,
      state: 'started',
      duplicate: false,
    })
  );
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    await result.current.sendMessage('Hello');
    events.push('run_started', {
      instanceId: 'run-1',
      messageId: sentMessage(0).id,
      text: 'Hello',
    });
    events.push('run_ended', {
      instanceId: 'run-1',
      status: 'failed',
      error: 'boom',
    });
    await settle();
  });
  expect(transcript()).toEqual([['user', 'Hello']]);
  expect(useChatStore.getState().error).toBe('boom');
  expect(useChatStore.getState().status).toBe('error');
});

it('reads on from the last event it saw when a stream ends', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const first = stream();
    const second = stream();
    vi.mocked(streamConversationEvents)
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const { result } = renderHook(() => useChatStream('workflow'));
    await act(async () => {
      void result.current.reconnect('conversation');
      await vi.advanceTimersByTimeAsync(0);
      first.push('reply', { text: 'one' }, 7);
      first.end();
      await vi.advanceTimersByTimeAsync(1500);
      // Seen already: a stream that repeats it does not show it twice.
      second.push('reply', { text: 'one' }, 7);
      second.push('reply', { text: 'two' }, 8);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(vi.mocked(streamConversationEvents).mock.calls[0][2]).toBe(0);
    expect(vi.mocked(streamConversationEvents).mock.calls[1][2]).toBe(7);
    expect(transcript()).toEqual([
      ['assistant', 'one'],
      ['assistant', 'two'],
    ]);
    act(() => result.current.cancelStream());
  } finally {
    vi.useRealTimers();
  }
});

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatStream } from './useChatStream';
import { useChatStore } from '../../stores/chatStore';
import {
  ConversationError,
  getConversation,
  sendMessage as sendConversationMessage,
  streamEvents,
} from '../../queries/conversations';

const submitInput = vi.hoisted(() => vi.fn());
vi.mock('./useChatInputs', () => ({
  useChatInputs: () => ({ refreshPendingInput: vi.fn(), submitInput }),
}));
vi.mock('@/shared/hooks/useToken', () => ({ useToken: () => 'token' }));
vi.mock('../../queries/conversations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/conversations')>()),
  getConversation: vi.fn(),
  sendMessage: vi.fn(),
  streamEvents: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.getState().resetChat();
  useChatStore.getState().resumeChat('workflow', 'Workflow', 'instance');
  useChatStore.getState().setConversationKey('conversation');
});
afterEach(cleanup);

const sentMessage = (call: number) =>
  vi.mocked(sendConversationMessage).mock.calls[call][3];
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
    body,
    push(
      kind: string,
      eventBody: Record<string, unknown>,
      at?: number,
      turn?: string
    ) {
      seq = at ?? seq + 1;
      const event = { seq, turn, kind, body: eventBody, createdAt: 'now' };
      controller.enqueue(
        encoder.encode(
          `id: ${String(seq)}\nevent: ${kind}\ndata: ${JSON.stringify(event)}\n\n`
        )
      );
    },
    /** What the stream sends once it has sent what was kept. */
    caughtUp() {
      controller.enqueue(
        encoder.encode(
          `event: caught_up\ndata: ${JSON.stringify({ kind: 'caught_up', body: { lastSeq: seq } })}\n\n`
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
    new ConversationError(
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
    async (_token, _workflow, _key, message) => ({
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
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    // How a chat is opened: a message that says nothing, shown to no one.
    events.push('message', { id: 'opening', payload: {} });
    events.push('message', { id: 'theirs', text: 'Hello' });
    // The text here is deprecated, and no longer what the line is read from.
    events.push('run_started', {
      instanceId: 'run-1',
      messageId: 'theirs',
      text: 'Not this',
    });
    events.push('activity', { type: 'tool_call', tool_name: 'lookup' });
    events.push('reply', { text: 'Working on it.' });
    events.push('waiting_for_input', {
      requestId: 'r',
      message: 'What next?',
      responseSchema: { message: { type: 'string' } },
    });
    events.push('message', { id: 'theirs-2', text: 'This' });
    events.push('message_delivered', {
      messageId: 'theirs-2',
      text: 'Nor this',
    });
    events.push('run_ended', { instanceId: 'run-1', status: 'completed' });
    await settle();
  });
  expect(transcript()).toEqual([
    ['user', 'Hello'],
    ['assistant', 'Working on it.'],
    ['user', 'This'],
  ]);
  expect(useChatStore.getState().instanceId).toBe('run-1');
  expect(useChatStore.getState().status).toBe('idle');
  expect(
    useChatStore.getState().messages.some((m) => m.content.includes('lookup'))
  ).toBe(true);
});

it("shows an AI Agent's answer until the run's reply in that turn stands for it", async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    events.push('message', { id: 'm', text: 'Hi' }, undefined, 'm');
    events.push(
      'activity',
      { type: 'message', content: 'Done.' },
      undefined,
      'm'
    );
    await settle();
  });
  expect(transcript()).toEqual([
    ['user', 'Hi'],
    ['assistant', 'Done.'],
  ]);
  await act(async () => {
    events.push('reply', { text: 'Done, as returned.' }, undefined, 'm');
    await settle();
  });
  expect(transcript()).toEqual([
    ['user', 'Hi'],
    ['assistant', 'Done, as returned.'],
  ]);
});

it.each(['before', 'after'])(
  'shows a message it sent once when its event arrives %s the send returns',
  async (order) => {
    const events = stream();
    vi.mocked(streamEvents).mockResolvedValue(events.body);
    let returnSend!: () => void;
    vi.mocked(sendConversationMessage).mockImplementation(
      (_token, _workflow, _key, message) =>
        new Promise((resolve) => {
          returnSend = () =>
            resolve({
              messageId: message.id,
              state: 'started',
              duplicate: false,
            });
        })
    );
    const { result } = renderHook(() => useChatStream('workflow'));
    await act(async () => {
      void result.current.reconnect('conversation');
      await settle();
      const sending = result.current.sendMessage('Hello');
      await settle();
      const id = sentMessage(0).id;
      if (order === 'after') {
        returnSend();
        await sending;
      }
      events.push('message', { id, text: 'Hello' }, undefined, id);
      events.push('run_started', { instanceId: 'run-1', messageId: id });
      await settle();
      if (order === 'before') {
        returnSend();
        await sending;
      }
      events.push('run_ended', {
        instanceId: 'run-1',
        status: 'failed',
        error: 'boom',
      });
      await settle();
    });
    expect(transcript()).toEqual([['user', 'Hello']]);
    expect(useChatStore.getState().messages.at(-1)?.content).toBe(
      'Error: boom'
    );
    expect(useChatStore.getState().error).toBeNull();
  }
);

it('shows a reply with an id once, however often it is read', async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const { result } = renderHook(() => useChatStream('workflow'));
  const reply = { replyId: 'story', instanceId: 'run-1', text: 'Once.' };
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    events.push('reply', reply, 3);
    // The same id from another run is another reply.
    events.push('reply', { ...reply, instanceId: 'run-2' }, 9);
    await settle();
  });
  // Read again from the start, as a reader that kept nothing would.
  act(() =>
    useChatStore.getState().applyConversationEvent({
      seq: 3,
      kind: 'reply',
      body: reply,
      createdAt: 'now',
    })
  );
  expect(transcript()).toEqual([
    ['assistant', 'Once.'],
    ['assistant', 'Once.'],
  ]);
});

it('is loading until the stream has caught up, then takes its status from the conversation', async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  vi.mocked(getConversation).mockResolvedValue({
    id: 'id',
    key: 'conversation',
    workflowId: 'workflow',
    createdAt: 'now',
    updatedAt: 'now',
    instanceId: 'run-2',
    waitingFor: { requestId: 'r', message: 'What next?' },
    lastSeq: 2,
    queued: 0,
    replyEvents: [],
  });
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    // An old run that failed: what was, not what is.
    events.push('run_started', { instanceId: 'run-1', messageId: 'm' });
    events.push('run_ended', { instanceId: 'run-1', status: 'failed' });
    await settle();
  });
  expect(useChatStore.getState().loading).toBe(true);
  expect(getConversation).not.toHaveBeenCalled();
  await act(async () => {
    events.caughtUp();
    await settle();
  });
  expect(useChatStore.getState().loading).toBe(false);
  expect(getConversation).toHaveBeenCalledTimes(1);
  expect(useChatStore.getState().status).toBe('waiting_for_input');
  expect(useChatStore.getState().instanceId).toBe('run-2');
  expect(useChatStore.getState().error).toBeNull();
});

it('reads on from the last event it saw when a stream ends', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const first = stream();
    const second = stream();
    vi.mocked(streamEvents)
      .mockResolvedValueOnce(first.body)
      .mockResolvedValueOnce(second.body);
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
    expect(vi.mocked(streamEvents).mock.calls[0][3]?.after).toBe(0);
    expect(vi.mocked(streamEvents).mock.calls[1][3]?.after).toBe(7);
    expect(transcript()).toEqual([
      ['assistant', 'one'],
      ['assistant', 'two'],
    ]);
    act(() => result.current.cancelStream());
  } finally {
    vi.useRealTimers();
  }
});

it('ends the chat when its conversation was deleted', async () => {
  vi.mocked(streamEvents).mockRejectedValue(
    new ConversationError('no such conversation', 'CONVERSATION_NOT_FOUND', 404)
  );
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(() => result.current.reconnect('conversation'));
  expect(streamEvents).toHaveBeenCalledTimes(1);
  expect(useChatStore.getState()).toMatchObject({
    error: 'This conversation was deleted',
    status: 'error',
    loading: false,
  });
});

it('says when the workspace has too many open chats, and asks again later', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const events = stream();
    vi.mocked(streamEvents)
      .mockRejectedValueOnce(
        new ConversationError(
          'too many streams',
          'CONVERSATION_STREAMS_FULL',
          429
        )
      )
      .mockResolvedValueOnce(events.body);
    const { result } = renderHook(() => useChatStream('workflow'));
    await act(async () => {
      void result.current.reconnect('conversation');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useChatStore.getState().error).toBe(
      'Too many open chats in this workspace'
    );
    // Later than a dropped stream is asked for again.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(streamEvents).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(streamEvents).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().error).toBeNull();
    act(() => result.current.cancelStream());
  } finally {
    vi.useRealTimers();
  }
});

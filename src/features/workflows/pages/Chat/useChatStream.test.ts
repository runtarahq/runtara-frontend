import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { titleFrom, useChatStream } from './useChatStream';
import { useChatStore } from '../../stores/chatStore';
import { getPendingInput } from '../../queries';
import {
  ConversationError,
  getConversation,
  openConversation,
  readBack,
  sendMessage as sendConversationMessage,
  stopConversation,
  streamEvents,
} from '../../queries/conversations';

const submitInput = vi.hoisted(() => vi.fn());
vi.mock('./useChatInputs', () => ({
  useChatInputs: () => ({ refreshPendingInput: vi.fn(), submitInput }),
}));
vi.mock('@/shared/hooks/useToken', () => ({ useToken: () => 'token' }));
vi.mock('@/features/workflows/queries', () => ({ getPendingInput: vi.fn() }));
vi.mock('../../queries/conversations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/conversations')>()),
  getConversation: vi.fn(),
  openConversation: vi.fn(),
  readBack: vi.fn(),
  sendMessage: vi.fn(),
  stopConversation: vi.fn(),
  streamEvents: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPendingInput).mockResolvedValue([]);
  vi.mocked(openConversation).mockResolvedValue({} as never);
  vi.mocked(readBack).mockResolvedValue([]);
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
    /** A piece of a reply as it is written: not kept, not numbered. */
    piece(offset: number, text: string) {
      const event = {
        seq: 0,
        kind: 'reply_delta',
        body: { replyId: 'story', instanceId: 'run-1', offset, text, n: 1 },
        createdAt: 'now',
      };
      controller.enqueue(
        encoder.encode(`event: reply_delta\ndata: ${JSON.stringify(event)}\n\n`)
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
    { conversationKey: 'conversation', id: original.id, message: 'Hello' },
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
    'Too many messages waiting; wait for a reply'
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
  // Said of the message, where it is shown.
  expect(useChatStore.getState().messages).toMatchObject([
    { role: 'user', content: 'Hello', failure: 'Workflow not found' },
  ]);
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

const waiting = {
  requestId: 'request',
  instanceId: 'run-1',
  message: 'What next?',
};
const standing = (waitingFor?: unknown) => ({
  id: 'id',
  key: 'conversation',
  workflowId: 'workflow',
  createdAt: 'now',
  updatedAt: 'now',
  instanceId: 'run-1',
  waitingFor,
  lastSeq: 99,
  queued: 0,
  replyEvents: [],
});
const delivered = (messageId: string) => ({
  messageId,
  state: 'delivered' as const,
  duplicate: false,
});

/** A chat whose run waits on `request`, as the conversation announced it. */
async function waitingChat(body: Record<string, unknown> = waiting) {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const hook = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void hook.result.current.reconnect('conversation');
    await settle();
    events.push('run_started', { instanceId: 'run-1', messageId: 'm' });
    events.push('waiting_for_input', body);
    await settle();
  });
  return { ...hook, events };
}

it('takes what the run waits for from the conversation, and sends what is typed as the answer to it', async () => {
  const { result, events } = await waitingChat();
  expect(useChatStore.getState()).toMatchObject({
    status: 'waiting_for_input',
    waitingForInput: { requestId: 'request', instanceId: 'run-1' },
  });
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => delivered(message.id)
  );
  await act(async () =>
    expect(await result.current.sendMessage('This one')).toBe(true)
  );
  expect(sentMessage(0)).toMatchObject({
    text: 'This one',
    inReplyTo: 'request',
  });
  // On the conversation, not on the run.
  expect(submitInput).not.toHaveBeenCalled();
  expect(useChatStore.getState()).toMatchObject({
    status: 'streaming',
    waitingForInput: null,
    pendingInputs: [],
  });
  // The answer is a message in the log: one line, with what it answered.
  await act(async () => {
    const id = sentMessage(0).id;
    events.push('message', { id, text: 'This one', inReplyTo: 'request' });
    events.push('message_delivered', {
      messageId: id,
      requestId: 'request',
      instanceId: 'run-1',
    });
    await settle();
  });
  expect(transcript()).toEqual([['user', 'This one']]);
});

it("sends a form's values as the payload of the answer", async () => {
  const { result } = await waitingChat({
    ...waiting,
    responseSchema: { city: { type: 'string' }, nights: { type: 'number' } },
  });
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => delivered(message.id)
  );
  await act(async () =>
    expect(
      await result.current.submitInput(
        'request',
        { city: 'Lviv', nights: 2 },
        'run-1',
        'City: Lviv | Nights: 2'
      )
    ).toBe(true)
  );
  expect(sentMessage(0)).toMatchObject({
    payload: { city: 'Lviv', nights: 2 },
    inReplyTo: 'request',
  });
  expect(sentMessage(0).text).toBeUndefined();
  expect(submitInput).not.toHaveBeenCalled();
  expect(transcript()).toEqual([['user', 'city: Lviv\nnights: 2']]);
});

it('closes the form of a request that is gone, and says so of the answer', async () => {
  const { result } = await waitingChat();
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => ({
      messageId: message.id,
      state: 'failed',
      detail: 'what this message answers is no longer waited for',
      duplicate: false,
    })
  );
  // The run has moved on to another request.
  vi.mocked(getConversation).mockResolvedValue(
    standing({ ...waiting, requestId: 'next' })
  );
  await act(async () =>
    expect(
      await result.current.submitInput('request', { city: 'Lviv' }, 'run-1')
    ).toBe(false)
  );
  expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  expect(useChatStore.getState().messages.at(-1)).toMatchObject({
    role: 'user',
    failure: 'That request is no longer open',
  });
  // Never sent to the other request, which is now the one offered.
  expect(useChatStore.getState().pendingInputs.map((r) => r.requestId)).toEqual(
    ['next']
  );
});

it('keeps the form of a request an answer did not fit', async () => {
  const { result } = await waitingChat();
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => ({
      messageId: message.id,
      state: 'failed',
      detail: 'city is required',
      duplicate: false,
    })
  );
  vi.mocked(getConversation).mockResolvedValue(standing(waiting));
  await act(async () =>
    expect(
      await result.current.submitInput('request', { nights: 2 }, 'run-1')
    ).toBe(false)
  );
  expect(useChatStore.getState().messages.at(-1)).toMatchObject({
    failure: 'city is required',
  });
  expect(useChatStore.getState().waitingForInput?.requestId).toBe('request');
});

it('retries an unconfirmed answer under its own id', async () => {
  const { result } = await waitingChat();
  vi.mocked(sendConversationMessage).mockRejectedValueOnce(
    new TypeError('lost acknowledgement')
  );
  await act(() =>
    result.current.submitInput('request', { city: 'Lviv' }, 'run-1')
  );
  const original = sentMessage(0);
  expect(result.current.uncertainMessages).toEqual([
    { conversationKey: 'conversation', id: original.id, message: 'Lviv' },
  ]);
  vi.mocked(sendConversationMessage).mockResolvedValue(delivered(original.id));
  await act(async () =>
    expect(await result.current.retryMessage(original.id)).toBe(true)
  );
  expect(sentMessage(1)).toEqual(original);
  expect(result.current.uncertainMessages).toEqual([]);
});

it('offers the other requests of a run that waits on several', async () => {
  vi.mocked(getPendingInput).mockResolvedValue([
    { requestId: 'request', message: 'What next?' },
    { requestId: 'other', message: 'And this?' },
  ] as never);
  await waitingChat();
  // The conversation announced one: the rest are read once from the run.
  // Reading back what was kept does not ask; the state it ends with does.
  expect(getPendingInput).not.toHaveBeenCalled();
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  vi.mocked(getConversation).mockResolvedValue(standing(waiting));
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    events.push('run_started', { instanceId: 'run-1', messageId: 'm' });
    events.push('waiting_for_input', waiting);
    events.caughtUp();
    await settle();
    await settle();
  });
  expect(getPendingInput).toHaveBeenCalledTimes(1);
  expect(useChatStore.getState().pendingInputs.map((r) => r.requestId)).toEqual(
    ['request', 'other']
  );
  expect(useChatStore.getState().waitingForInput?.requestId).toBe('request');
});

it('answers a run that no conversation started on the run itself', async () => {
  useChatStore.getState().setConversationKey(null);
  useChatStore
    .getState()
    .setPendingInputs([{ requestId: 'request', instanceId: 'instance' }]);
  submitInput.mockResolvedValue(true);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () =>
    expect(await result.current.sendMessage('Yes')).toBe(true)
  );
  expect(submitInput).toHaveBeenCalledWith(
    'request',
    { message: 'Yes' },
    'instance'
  );
  expect(sendConversationMessage).not.toHaveBeenCalled();
  expect(transcript()).toEqual([['user', 'Yes']]);
});

it('shows a reply as it is written, a frame at a time, then once as it is said', async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) =>
    frames.push(run)
  );
  vi.stubGlobal('cancelAnimationFrame', () => {});
  try {
    const { result } = renderHook(() => useChatStream('workflow'));
    await act(async () => {
      void result.current.reconnect('conversation');
      await settle();
      events.push('run_started', { instanceId: 'run-1', messageId: 'm' }, 5);
      events.piece(0, 'Once');
      events.piece(4, ' upon');
      await settle();
    });
    // Read, though not numbered; held until the frame.
    expect(transcript()).toEqual([]);
    expect(frames).toHaveLength(1);
    act(() => frames[0](0));
    expect(transcript()).toEqual([['assistant', 'Once upon']]);
    expect(useChatStore.getState().messages.at(-1)?.isStreaming).toBe(true);
    await act(async () => {
      events.piece(9, ' a time');
      // The reply follows its pieces, with no frame between.
      events.push(
        'reply',
        { replyId: 'story', instanceId: 'run-1', text: 'Once upon a time.' },
        6
      );
      // Not moved back by a piece's `seq` of 0: this is still read once.
      events.push('reply', { text: 'The end.' }, 7);
      await settle();
    });
    expect(transcript()).toEqual([
      ['assistant', 'Once upon a time.'],
      ['assistant', 'The end.'],
    ]);
    expect(useChatStore.getState().messages.at(-2)?.isStreaming).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('shows a message sent while a run is busy as queued, until its own run starts', async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  vi.mocked(getConversation).mockResolvedValue({
    ...standing(),
    lastSeq: 0,
    queued: 2,
  });
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => queued(message.id)
  );
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
    events.caughtUp();
    events.push('run_started', { instanceId: 'run-1', messageId: 'first' });
    await settle();
  });
  expect(useChatStore.getState().status).toBe('streaming');
  await act(async () =>
    expect(await result.current.sendMessage('Second')).toBe(true)
  );
  const id = sentMessage(0).id;
  expect(useChatStore.getState().messages.at(-1)).toMatchObject({
    content: 'Second',
    queued: true,
  });
  // How many wait is the conversation's to say.
  expect(useChatStore.getState().queued).toBe(2);
  await act(async () => {
    events.push('run_ended', { instanceId: 'run-1', status: 'completed' });
    events.push('run_started', { instanceId: 'run-2', messageId: id });
    await settle();
  });
  expect(
    useChatStore.getState().messages.find((m) => m.content === 'Second')?.queued
  ).toBe(false);
});

it('stops the run through the conversation, and may drop what waits', async () => {
  vi.mocked(stopConversation).mockResolvedValue({ cleared: 0 });
  vi.mocked(getConversation).mockResolvedValue(standing());
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(() => result.current.stop());
  expect(stopConversation).toHaveBeenLastCalledWith(
    'token',
    'workflow',
    'conversation',
    { clearQueue: false }
  );
  await act(() => result.current.stop(true));
  expect(stopConversation).toHaveBeenLastCalledWith(
    'token',
    'workflow',
    'conversation',
    { clearQueue: true }
  );
  vi.mocked(stopConversation).mockRejectedValue(new Error('no such run'));
  await act(() => result.current.stop());
  expect(useChatStore.getState().error).toBe('no such run');
});

it("opens a new chat as the console's, then lets the workflow speak first", async () => {
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  vi.mocked(openConversation).mockResolvedValue({
    ...standing(),
    instanceId: undefined,
  });
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => ({
      messageId: message.id,
      state: 'started',
      duplicate: false,
    })
  );
  const opened = vi.fn();
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.startSession(opened);
    await settle();
  });
  const key = vi.mocked(openConversation).mock.calls[0][2];
  expect(key).toMatch(/^console:/);
  expect(vi.mocked(openConversation).mock.calls[0][3]).toEqual({
    metadata: { source: 'console' },
  });
  expect(opened).toHaveBeenCalledWith(key);
  // Opened before anything is said in it.
  expect(vi.mocked(openConversation).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(sendConversationMessage).mock.invocationCallOrder[0]
  );
  expect(sentMessage(0)).toMatchObject({ payload: {} });
  expect(vi.mocked(sendConversationMessage).mock.calls[0][2]).toBe(key);
  act(() => result.current.cancelStream());
});

it('names an untitled conversation by the first thing said in it, once', async () => {
  vi.mocked(openConversation).mockResolvedValue(standing());
  vi.mocked(sendConversationMessage).mockImplementation(
    async (_token, _workflow, _key, message) => queued(message.id)
  );
  vi.mocked(getConversation).mockResolvedValue(standing());
  const { result } = renderHook(() => useChatStream('workflow'));
  // Not yet read: it may have a title a person gave it.
  await act(() => result.current.sendMessage('Too early'));
  expect(openConversation).not.toHaveBeenCalled();
  act(() => useChatStore.getState().setTitle(null));
  await act(() =>
    result.current.sendMessage('Where is my order?\nIt was due on Monday.')
  );
  expect(openConversation).toHaveBeenCalledWith(
    'token',
    'workflow',
    'conversation',
    { title: 'Where is my order?' }
  );
  expect(useChatStore.getState().title).toBe('Where is my order?');
  await act(() => result.current.sendMessage('And another thing'));
  expect(openConversation).toHaveBeenCalledTimes(1);
});

it('shortens a long first message into a title', () => {
  const title = titleFrom(`${'word '.repeat(30)}end`);
  expect(title.length).toBeLessThanOrEqual(60);
  expect(title.endsWith('…')).toBe(true);
  expect(titleFrom('  Short   one \n more')).toBe('Short one');
});

const kept = (seq: number, text: string) => ({
  seq,
  turn: `m${String(seq)}`,
  kind: 'message' as const,
  body: { id: `m${String(seq)}`, text },
  createdAt: 'then',
});

it('opens a conversation with its last events and reads on from them, with no gap or overlap', async () => {
  // Newest first, as the log is read back.
  vi.mocked(readBack).mockResolvedValue([
    kept(42, 'latest'),
    kept(41, 'before'),
  ]);
  const events = stream();
  vi.mocked(streamEvents).mockResolvedValue(events.body);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
  });
  expect(vi.mocked(readBack).mock.calls[0][3]).toEqual({ limit: 200 });
  // Not replayed from the first: read on from the last event read back.
  expect(vi.mocked(streamEvents).mock.calls[0][3]?.after).toBe(42);
  expect(transcript()).toEqual([
    ['user', 'before'],
    ['user', 'latest'],
  ]);
  await act(async () => {
    // Sent again by a stream that began a little earlier: not shown twice.
    events.push('message', { id: 'm42', text: 'latest' }, 42);
    events.push('message', { id: 'm43', text: 'new' }, 43);
    events.caughtUp();
    await settle();
  });
  expect(transcript()).toEqual([
    ['user', 'before'],
    ['user', 'latest'],
    ['user', 'new'],
  ]);
  expect(useChatStore.getState().loading).toBe(false);
  act(() => result.current.cancelStream());
});

it('reads earlier events when asked, until the first', async () => {
  const page = Array.from({ length: 200 }, (_, at) =>
    kept(400 - at, `said ${String(400 - at)}`)
  );
  vi.mocked(readBack).mockResolvedValueOnce(page);
  vi.mocked(streamEvents).mockResolvedValue(stream().body);
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(async () => {
    void result.current.reconnect('conversation');
    await settle();
  });
  expect(useChatStore.getState()).toMatchObject({
    firstSeq: 201,
    hasEarlier: true,
  });
  vi.mocked(readBack).mockResolvedValueOnce([kept(200, 'said 200')]);
  await act(() => result.current.loadEarlier());
  expect(vi.mocked(readBack).mock.calls[1][3]).toEqual({
    before: 201,
    limit: 200,
  });
  expect(transcript()[0]).toEqual(['user', 'said 200']);
  expect(transcript()).toHaveLength(201);
  // A short page is the last one: nothing more is asked for.
  expect(useChatStore.getState().hasEarlier).toBe(false);
  await act(() => result.current.loadEarlier());
  expect(readBack).toHaveBeenCalledTimes(2);
  act(() => result.current.cancelStream());
});

it('ends the chat when the conversation to reopen is gone', async () => {
  vi.mocked(readBack).mockRejectedValue(
    new ConversationError('no such conversation', 'CONVERSATION_NOT_FOUND', 404)
  );
  const { result } = renderHook(() => useChatStream('workflow'));
  await act(() => result.current.reconnect('conversation'));
  expect(streamEvents).not.toHaveBeenCalled();
  expect(useChatStore.getState()).toMatchObject({
    error: 'This conversation was deleted',
    loading: false,
  });
});

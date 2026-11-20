import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationError,
  deleteConversation,
  getConversation,
  issueToken,
  listConversations,
  openConversation,
  readBack,
  readStream,
  sendMessage,
  stopConversation,
  streamEvents,
} from './conversations';

vi.mock('@/shared/queries/utils', () => ({
  getRuntimeBaseUrl: () => 'http://api/runtime',
}));

const base = 'http://api/runtime/workflows/workflow/conversations';

function answers(data: unknown, init?: ResponseInit) {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ success: true, data }), init)
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function refuses(status: number, code: string, message: string) {
  const fetch = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ success: false, code, message }), {
        status,
      })
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body!;
}

afterEach(() => vi.unstubAllGlobals());

describe('the conversation client', () => {
  it('opens a conversation with PUT, under its encoded key', async () => {
    const state = { key: 'a key', lastSeq: 0, queued: 0 };
    const fetch = answers(state);
    expect(
      await openConversation('token', 'workflow', 'a key', {
        title: 'Hello',
        metadata: { source: 'console' },
      })
    ).toEqual(state);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${base}/a%20key`);
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer token');
    expect(JSON.parse(init.body)).toEqual({
      title: 'Hello',
      metadata: { source: 'console' },
    });
  });

  it('sends null to remove a title', async () => {
    const fetch = answers({});
    await openConversation('token', 'workflow', 'key', { title: null });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: null });
  });

  it('reads a conversation as it stands', async () => {
    const fetch = answers({ key: 'key', queued: 2 });
    expect(await getConversation('token', 'workflow', 'key')).toEqual({
      key: 'key',
      queued: 2,
    });
    expect(fetch.mock.calls[0][0]).toBe(`${base}/key`);
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('lists a page with its prefix, cursor and limit', async () => {
    const fetch = answers({ conversations: [], next: 'more' });
    expect(
      await listConversations('token', 'workflow', {
        prefix: 'console:',
        cursor: 'c 1',
        limit: 50,
      })
    ).toEqual({ conversations: [], next: 'more' });
    expect(fetch.mock.calls[0][0]).toBe(
      `${base}?prefix=console%3A&cursor=c+1&limit=50`
    );
  });

  it('lists the first page with no query', async () => {
    const fetch = answers({ conversations: [] });
    await listConversations('token', 'workflow');
    expect(fetch.mock.calls[0][0]).toBe(base);
  });

  it('sends a message as it is, with what it answers', async () => {
    const message = {
      id: 'message',
      payload: { city: 'Lviv' },
      inReplyTo: 'request',
      attachments: [{ name: 'a', url: 'http://a' }],
    };
    const sent = { messageId: 'message', state: 'delivered', duplicate: false };
    const fetch = answers(sent);
    expect(
      await sendMessage('token', 'workflow', 'key', message, { wait: 30 })
    ).toEqual(sent);
    expect(fetch.mock.calls[0][0]).toBe(`${base}/key/messages?wait=30`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(message);
  });

  it('rejects an answer for another message', async () => {
    answers({ messageId: 'other', state: 'queued', duplicate: false });
    const failure = sendMessage('token', 'workflow', 'key', { id: 'message' });
    await expect(failure).rejects.toThrow('could not be confirmed');
    // Nothing was confirmed, so it has no status: it may be sent again.
    await expect(failure).rejects.toMatchObject({ status: undefined });
  });

  it.each([
    [404, 'CONVERSATION_NOT_FOUND'],
    [400, 'CONVERSATION_INVALID'],
    [429, 'CONVERSATION_QUEUE_FULL'],
    [503, 'CONVERSATION_UNAVAILABLE'],
  ])('keeps the status %i and code %s of a refusal', async (status, code) => {
    refuses(status, code, 'refused');
    await expect(
      sendMessage('token', 'workflow', 'key', { id: 'm' })
    ).rejects.toMatchObject({
      name: 'ConversationError',
      code,
      status,
      message: 'refused',
    } satisfies Partial<ConversationError>);
  });

  it('asks for a stream after an event, by query and by header', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('retry: 2000\n\n'));
    vi.stubGlobal('fetch', fetch);
    await streamEvents('token', 'workflow', 'key', {
      after: 7,
      kinds: ['message', 'reply'],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${base}/key/events?after=7&kinds=message%2Creply`);
    expect(init.headers.Accept).toBe('text/event-stream');
    expect(init.headers['Last-Event-ID']).toBe('7');
  });

  it('asks for a stream from the first event with no Last-Event-ID', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('retry: 2000\n\n'));
    vi.stubGlobal('fetch', fetch);
    await streamEvents('token', 'workflow', 'key');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${base}/key/events?after=0`);
    expect(init.headers['Last-Event-ID']).toBeUndefined();
  });

  it('keeps the code of a refused stream', async () => {
    refuses(429, 'CONVERSATION_STREAMS_FULL', 'too many streams');
    await expect(
      streamEvents('token', 'workflow', 'key')
    ).rejects.toMatchObject({
      code: 'CONVERSATION_STREAMS_FULL',
      status: 429,
    });
  });

  it('reads a stream as its events, kept ones and caught_up', async () => {
    const stream = sse(
      [
        'retry: 2000',
        '',
        'id: 1',
        'event: message',
        'data: {"seq":1,"turn":"m","kind":"message","body":{"id":"m","text":"hi"},"createdAt":"now"}',
        '',
        'event: reply_delta',
        'data: {"seq":0,"kind":"reply_delta","body":{"replyId":"r","offset":0,"text":"He","n":1,"instanceId":"i"},"createdAt":"now"}',
        '',
        'event: caught_up',
        'data: {"body":{"lastSeq":1},"kind":"caught_up"}',
        '',
        'event: something_new',
        'data: {"seq":2,"kind":"something_new","body":{},"createdAt":"now"}',
        '',
        '',
      ].join('\n')
    );
    const kinds: string[] = [];
    for await (const event of readStream(stream)) kinds.push(event.kind);
    expect(kinds).toEqual([
      'message',
      'reply_delta',
      'caught_up',
      'something_new',
    ]);
  });

  it('reads back from the newest, before an event', async () => {
    const fetch = answers([{ seq: 4 }, { seq: 3 }]);
    expect(
      await readBack('token', 'workflow', 'key', { before: 5, limit: 2 })
    ).toEqual([{ seq: 4 }, { seq: 3 }]);
    expect(fetch.mock.calls[0][0]).toBe(
      `${base}/key/events?order=desc&before=5&limit=2`
    );
    expect(fetch.mock.calls[0][1].headers.Accept).toBeUndefined();
  });

  it('stops, and says whether to clear the queue', async () => {
    const fetch = answers({ instanceId: 'run', cleared: 2 });
    expect(
      await stopConversation('token', 'workflow', 'key', { clearQueue: true })
    ).toEqual({ instanceId: 'run', cleared: 2 });
    expect(fetch.mock.calls[0][0]).toBe(`${base}/key/stop`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      clearQueue: true,
    });
  });

  it('deletes, and reports a conversation that is gone', async () => {
    const fetch = answers(undefined);
    await deleteConversation('token', 'workflow', 'key');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    refuses(404, 'CONVERSATION_NOT_FOUND', 'no such conversation');
    await expect(
      deleteConversation('token', 'workflow', 'key')
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND', status: 404 });
  });

  it('issues a token for the lifetime asked', async () => {
    const issued = { token: 'rtc_x', expiresAt: 'later' };
    const fetch = answers(issued);
    expect(
      await issueToken('token', 'workflow', 'key', { ttlSeconds: 86400 })
    ).toEqual(issued);
    expect(fetch.mock.calls[0][0]).toBe(`${base}/key/token`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      ttlSeconds: 86400,
    });
  });
});

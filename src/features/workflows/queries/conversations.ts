import type {
  ConversationEvent,
  ConversationList,
  ConversationState,
  IssuedToken,
  IssueToken,
  Message,
  OpenConversation,
  Sent,
  Stopped,
} from '@/generated/RuntaraRuntimeApi';
import { getRuntimeBaseUrl } from '@/shared/queries/utils';
import { parseSSEStream } from '../utils/sse';

/**
 * A conversation with a workflow: the routes under
 * `/workflows/{id}/conversations`, typed by the generated client's types.
 * They are called with `fetch` because the event stream has to be, and a
 * refusal has to keep its code and status.
 */

/** A refusal, or an answer that could not be read, with what the server
 * said of it. Without a status nothing was heard: the request may or may not
 * have been taken. */
export class ConversationError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ConversationError';
  }
}

/** Sent on a stream once it has sent what was kept. It is not kept itself:
 * it has no `seq` and no `turn`. */
export interface CaughtUp {
  kind: 'caught_up';
  body: { lastSeq: number };
}

/** What a stream sends: the log's events, and `caught_up`. A kind this
 * console does not know is passed on as it is, for its reader to ignore. */
export type ConversationStreamEvent = ConversationEvent | CaughtUp;

// Where the runtime API is, when it is not where the signed-in console's
// is: a page that holds a conversation token has no session to tell it.
let runtimeBase: string | null = null;

/**
 * Reads conversations from the runtime API at `base` from now on, in place
 * of the signed-in console's. For a page that is given a conversation token
 * and the API's address together, and is the only thing running.
 */
export function readConversationsAt(base: string | null) {
  runtimeBase = base ? base.replace(/\/$/, '') : null;
}

function conversationsUrl(workflowId: string): string {
  return `${runtimeBase ?? getRuntimeBaseUrl()}/workflows/${encodeURIComponent(workflowId)}/conversations`;
}

function conversationUrl(workflowId: string, key: string): string {
  return `${conversationsUrl(workflowId)}/${encodeURIComponent(key)}`;
}

function withQuery(
  url: string,
  query: Record<string, string | number | undefined>
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(name, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  code?: string;
  message?: string;
}

async function refusal(
  response: Response,
  fallback: string
): Promise<ConversationError> {
  const body = (await response.json().catch(() => ({}))) as Envelope<unknown>;
  return new ConversationError(
    body.message ?? fallback,
    body.code,
    response.status
  );
}

async function call<T>(
  token: string,
  url: string,
  init: { method: string; body?: unknown; signal?: AbortSignal },
  fallback: string
): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!response.ok) throw await refusal(response, fallback);
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!body.success || body.data === undefined || body.data === null)
    throw new ConversationError(body.message ?? fallback, body.code);
  return body.data;
}

/** Open the conversation a key names, or find it. A field left out is kept;
 * `null` removes a title or a reply workflow. */
export function openConversation(
  token: string,
  workflowId: string,
  key: string,
  conversation: OpenConversation = {},
  signal?: AbortSignal
): Promise<ConversationState> {
  return call(
    token,
    conversationUrl(workflowId, key),
    { method: 'PUT', body: conversation, signal },
    'The conversation could not be opened'
  );
}

/** The conversation as it stands: its run, what that run waits for, and how
 * many messages wait their turn. */
export function getConversation(
  token: string,
  workflowId: string,
  key: string,
  signal?: AbortSignal
): Promise<ConversationState> {
  return call(
    token,
    conversationUrl(workflowId, key),
    { method: 'GET', signal },
    'The conversation could not be read'
  );
}

/** A page of the workflow's conversations, most recently active first. */
export function listConversations(
  token: string,
  workflowId: string,
  page: { prefix?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<ConversationList> {
  return call(
    token,
    withQuery(conversationsUrl(workflowId), page),
    { method: 'GET', signal },
    'The conversations could not be listed'
  );
}

/**
 * Send a message into a conversation, which is opened if it was not. It
 * starts a run, answers a waiting one, or waits its turn; the answer says
 * which. With `inReplyTo` it answers that request and no other. With `wait`
 * the answer waits that many seconds for the turn and carries its events.
 */
export async function sendMessage(
  token: string,
  workflowId: string,
  key: string,
  message: Message,
  options: { wait?: number; signal?: AbortSignal } = {}
): Promise<Sent> {
  const sent = await call<Sent>(
    token,
    withQuery(`${conversationUrl(workflowId, key)}/messages`, {
      wait: options.wait,
    }),
    { method: 'POST', body: message, signal: options.signal },
    'The message could not be sent'
  );
  if (sent.messageId !== message.id)
    throw new ConversationError('The message could not be confirmed');
  return sent;
}

/**
 * The conversation's events after `after`, as a stream: what is kept, then
 * `caught_up`, then each event as it is said. The server ends a stream after
 * a while; the caller reads on from the last event it saw. `kinds` left out
 * asks for every kind, the pieces of replies among them.
 *
 * Where to read on from is said by `after` alone. `Last-Event-ID` says the
 * same, but the server's CORS policy does not allow that header, and the
 * console is served from another origin than the API: sending it makes the
 * browser refuse the request before it is made.
 */
export async function streamEvents(
  token: string,
  workflowId: string,
  key: string,
  options: { after?: number; kinds?: string[]; signal?: AbortSignal } = {}
): Promise<ReadableStream<Uint8Array>> {
  const after = options.after ?? 0;
  const response = await fetch(
    withQuery(`${conversationUrl(workflowId, key)}/events`, {
      after,
      kinds: options.kinds?.join(','),
    }),
    {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      signal: options.signal,
    }
  );
  if (!response.ok)
    throw await refusal(response, 'The conversation could not be read');
  if (!response.body)
    throw new ConversationError('The conversation sent no stream');
  return response.body;
}

/** The events of a stream, one by one, as the server sent them. */
export async function* readStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ConversationStreamEvent> {
  for await (const parsed of parseSSEStream(stream, signal)) {
    const event = parsed.data as unknown as ConversationStreamEvent;
    if (typeof event?.kind === 'string') yield event;
  }
}

/** Read back: at most `limit` events before `before` (or the newest),
 * newest first. */
export function readBack(
  token: string,
  workflowId: string,
  key: string,
  options: { before?: number; limit?: number; kinds?: string[] } = {},
  signal?: AbortSignal
): Promise<ConversationEvent[]> {
  return call(
    token,
    withQuery(`${conversationUrl(workflowId, key)}/events`, {
      order: 'desc',
      before: options.before,
      limit: options.limit,
      kinds: options.kinds?.join(','),
    }),
    { method: 'GET', signal },
    'The conversation could not be read'
  );
}

/** Stop the run that carries the conversation; with `clearQueue`, drop the
 * messages waiting their turn too. No run to stop is not an error. */
export function stopConversation(
  token: string,
  workflowId: string,
  key: string,
  options: { clearQueue?: boolean } = {}
): Promise<Stopped> {
  return call(
    token,
    `${conversationUrl(workflowId, key)}/stop`,
    { method: 'POST', body: options },
    'The conversation could not be stopped'
  );
}

/** Delete the conversation and everything said in it. */
export async function deleteConversation(
  token: string,
  workflowId: string,
  key: string
): Promise<void> {
  const response = await fetch(conversationUrl(workflowId, key), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw await refusal(response, 'The conversation could not be deleted');
}

/** A credential for this one conversation, handed over once. */
export function issueToken(
  token: string,
  workflowId: string,
  key: string,
  request: IssueToken = {}
): Promise<IssuedToken> {
  return call(
    token,
    `${conversationUrl(workflowId, key)}/token`,
    { method: 'POST', body: request },
    'The link could not be made'
  );
}

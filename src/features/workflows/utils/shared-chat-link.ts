// A link to one conversation, for someone who is not a member: it opens a
// chat page that talks to the workflow with a conversation token and nothing
// else. Imports nothing, so the app's entry can ask whether the page is that
// one before it loads anything else.

/** The page's path under the console's root. */
export const SHARED_CHAT_PATH = 'shared-chat';

/** What a link carries. It is all in the URL's fragment, which a browser
 * sends to no server. */
export interface SharedChat {
  workflowId: string;
  /** The conversation's key. */
  key: string;
  /** The conversation token (`rtc_…`). */
  token: string;
  /** The tenant the runtime API is asked under, where its path names one. */
  org?: string;
  /** The sender the token's messages are from: this page's own. */
  sender?: string;
  /** When the token stops being taken. */
  expiresAt?: string;
}

// What the console puts in an API path. Anything else (`..`, an escape)
// could aim the page's requests elsewhere, and names nothing.
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `pathname` is the shared chat page's, wherever the console is
 * mounted. */
export function isSharedChatPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '').split('/').pop() === SHARED_CHAT_PATH;
}

/** The link to a conversation, under the console's root `appBaseUrl`. */
export function sharedChatLink(appBaseUrl: string, chat: SharedChat): string {
  const fragment = new URLSearchParams({
    workflow: chat.workflowId,
    key: chat.key,
    token: chat.token,
  });
  if (chat.org) fragment.set('org', chat.org);
  if (chat.sender) fragment.set('as', chat.sender);
  if (chat.expiresAt) fragment.set('until', chat.expiresAt);
  const url = new URL(SHARED_CHAT_PATH, appBaseUrl);
  url.hash = fragment.toString();
  return url.href;
}

/** What a link's fragment carries, or `null` when it is not a whole link. */
export function readSharedChatLink(hash: string): SharedChat | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const workflowId = fragment.get('workflow');
  const key = fragment.get('key');
  const token = fragment.get('token');
  const org = fragment.get('org');
  if (!workflowId || !key || !token) return null;
  if (!SEGMENT.test(workflowId) || !token.startsWith('rtc_')) return null;
  if (org && !SEGMENT.test(org)) return null;
  return {
    workflowId,
    key,
    token,
    ...(org ? { org } : {}),
    ...(fragment.get('as') ? { sender: fragment.get('as')! } : {}),
    ...(fragment.get('until') ? { expiresAt: fragment.get('until')! } : {}),
  };
}

/**
 * The runtime API a link's conversation is read from: the deployment's own,
 * under the link's tenant. The address is the deployment's, never the
 * link's, so a link cannot point the page at another server.
 */
export function sharedChatApi(apiBaseUrl: string, org?: string): string {
  const base = `${apiBaseUrl.replace(/\/$/, '')}/api/runtime`;
  return org ? `${base}/${encodeURIComponent(org)}` : base;
}

/**
 * The tenant segment of the signed-in console's runtime API address
 * (`…/api/runtime/<org>`), for a link made from it. Empty where the address
 * names none.
 */
export function orgOfRuntimeBase(runtimeBase: string): string | undefined {
  const after = runtimeBase.split('/api/runtime')[1] ?? '';
  const org = decodeURIComponent(after.replace(/^\//, ''));
  return SEGMENT.test(org) ? org : undefined;
}

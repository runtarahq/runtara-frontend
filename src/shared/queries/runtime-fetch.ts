import { currentAccessToken } from '@/shared/auth/access-token';
import { reportResponseStatus } from './response-status';
import { getRuntimeBaseUrl } from './utils';

/**
 * `fetch` for the runtime API, for what the generated client cannot do: read a
 * response as a stream, or call a route it does not have yet.
 *
 * `path` is the part after `/api/runtime/{tenant}` (`/workflows/…`). The
 * request carries the signed-in user's token unless the caller set an
 * `Authorization` header, and a 401 or 503 answer is handled as the generated
 * client's is (`reportResponseStatus`). The response comes back as it is, any
 * status: what a refusal means is the caller's to say.
 */
export async function runtimeFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    const token = currentAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${getRuntimeBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  reportResponseStatus(response.status);
  return response;
}

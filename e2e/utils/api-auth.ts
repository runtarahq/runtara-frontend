import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// How the real-backend specs call the server's API beside the browser.
//
// Against a server that signs in through an identity provider, the `setup`
// project saves a signed-in browser state, and the token is read from it.
// Against one in local or trust-proxy auth (runtara's evaluation stack, a
// developer's own server) there is no token, and none is sent.

const authFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.auth/user.json'
);

const authMode =
  process.env.E2E_SMOKE_AUTH_MODE || process.env.VITE_RUNTARA_AUTH_MODE;

/** Whether the server under test needs no token. */
export const serverNeedsNoToken =
  authMode === 'local' ||
  authMode === 'trust_proxy' ||
  authMode === 'trust-proxy';

/** The signed-in user's access token, or '' where the server needs none. */
export function getAccessToken(): string {
  if (serverNeedsNoToken) return '';
  const raw = JSON.parse(fs.readFileSync(authFile, 'utf-8'));

  for (const origin of raw.origins ?? []) {
    for (const entry of origin.localStorage ?? []) {
      if (entry.name.startsWith('oidc.user:')) {
        const parsed =
          typeof entry.value === 'string'
            ? JSON.parse(entry.value)
            : entry.value;
        return parsed.access_token;
      }
    }
  }

  throw new Error('No access token found in auth state file');
}

/** Headers of a JSON request to the API, signed where a token is needed. */
export function apiHeaders(token: string): Record<string, string> {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json',
  };
}

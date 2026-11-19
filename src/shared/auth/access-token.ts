import { User } from 'oidc-client-ts';
import { config, isOidcAuth } from '@/shared/config/runtimeConfig';

/**
 * The signed-in user's access token, or `undefined` without one: not signed
 * in, a token past its expiry, or an auth mode in which the server asks for
 * none (`local`, `trust_proxy`).
 *
 * Read from where `oidc-client-ts` keeps the user (`oidcConfig.userStore`),
 * so it is the token of the latest silent renew, and code outside React (an
 * HTTP interceptor, the validator's loader) needs no hook to get it.
 */
export function currentAccessToken(): string | undefined {
  if (!isOidcAuth) return undefined;
  const { authority, clientId } = config.oidc;
  if (!authority || !clientId) return undefined;
  try {
    const stored = window.localStorage.getItem(
      `oidc.user:${authority}:${clientId}`
    );
    if (!stored) return undefined;
    const user = User.fromStorageString(stored);
    return user.expired ? undefined : user.access_token;
  } catch {
    return undefined;
  }
}

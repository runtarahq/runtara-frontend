import { isOidcAuth } from '@/shared/config/runtimeConfig';
import { useAuthStore } from '@/shared/stores/authStore.ts';
import { useMaintenanceStore } from '@/shared/stores/maintenanceStore.ts';

let isRedirectingToLogin = false;

/**
 * What the console does about a response's status whichever way the request
 * was made (the generated client or `runtimeFetch`):
 *
 * - 503: the server is down for maintenance, and the console says so.
 * - 401 under OIDC: the token is expired or invalid, so the session is dropped
 *   and the user sent to sign in. The stored session goes first, or
 *   `useAutoSignin` would sign in with it again and hit the same 401. Other
 *   auth modes have no login to return to, so a 401 there is the caller's.
 */
export function reportResponseStatus(status: number | undefined): void {
  if (status === 503) {
    useMaintenanceStore.getState().setMaintenanceMode(true);
  }
  if (status === 401 && isOidcAuth && !isRedirectingToLogin) {
    isRedirectingToLogin = true;
    useAuthStore.getState().clearOrgId();
    useAuthStore.getState().clearUserGroups();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('oidc.')) {
        localStorage.removeItem(key);
      }
    }
    window.location.href = window.location.origin;
  }
}

/** For tests: forget that a redirect to login was started. */
export function resetResponseStatusForTests(): void {
  isRedirectingToLogin = false;
}

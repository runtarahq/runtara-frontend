import * as ManagementAPI from '@/generated/RuntaraManagementApi.ts';
import * as RuntimeAPI from '@/generated/RuntaraRuntimeApi.ts';
import type { AxiosHeaders } from 'axios';
import { currentAccessToken } from '@/shared/auth/access-token';
import { config } from '@/shared/config/runtimeConfig';
import { useAuthStore } from '@/shared/stores/authStore.ts';
import { reportResponseStatus } from './response-status';

// Resolve the API base URL. When unset (one host routing /api to the server,
// or vite dev), we use relative URLs and let the browser resolve them.
const API_BASE_URL = config.apiBaseUrl;

/**
 * Management API client - single shared instance
 * Used for management operations
 */
export const ManagementAPIClient = new ManagementAPI.Api({
  format: 'json',
  baseURL: API_BASE_URL,
});

/**
 * Runtime API client - single shared instance
 * All features should import this instead of creating their own instance
 */
export const RuntimeREST = new RuntimeAPI.Api({
  format: 'json',
  baseURL: API_BASE_URL,
});

// Interceptor: insert org_id into /api/runtime/ paths (skipped when stripOrgId
// is set — by build-time VITE_STRIP_ORG_ID or runtime RUNTARA_UI_STRIP_ORG_ID).
RuntimeREST.instance.interceptors.request.use((requestConfig) => {
  const orgId = useAuthStore.getState().orgId;
  if (orgId && requestConfig.url && !config.stripOrgId) {
    requestConfig.url = requestConfig.url.replace(
      /\/api\/runtime\//,
      () => `/api/runtime/${encodeURIComponent(orgId)}/`
    );
  }
  return requestConfig;
});

/**
 * Sends the signed-in user's token with a call to the API, unless the caller
 * set an `Authorization` header itself. A query function therefore needs no
 * token of its own; those that still pass one keep working.
 */
export const attachAccessToken = <
  T extends { url?: string; headers: AxiosHeaders },
>(
  requestConfig: T
): T => {
  if (
    requestConfig.url?.startsWith('/api/') &&
    !requestConfig.headers.has('Authorization')
  ) {
    const token = currentAccessToken();
    if (token) requestConfig.headers.set('Authorization', `Bearer ${token}`);
  }
  return requestConfig;
};

// 503 turns maintenance mode on and a 401 sends the user to sign in: the same
// for every way of calling the API (see reportResponseStatus).
const statusInterceptor = (error: any) => {
  reportResponseStatus(error?.response?.status);
  return Promise.reject(error);
};

for (const client of [ManagementAPIClient, RuntimeREST]) {
  client.instance.interceptors.request.use(attachAccessToken);
  client.instance.interceptors.response.use(undefined, statusInterceptor);
}

export * from './billing';

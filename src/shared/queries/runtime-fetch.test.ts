import { AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  isOidcAuth: true,
  config: { apiBaseUrl: 'https://api.test/', stripOrgId: false, oidc: {} },
}));
const token = vi.hoisted(() => ({ current: 'token-1' as string | undefined }));
vi.mock('@/shared/config/runtimeConfig', () => runtime);
vi.mock('@/shared/auth/access-token', () => ({
  currentAccessToken: () => token.current,
}));

import { attachAccessToken } from './index';
import { resetResponseStatusForTests } from './response-status';
import { runtimeFetch } from './runtime-fetch';
import { useAuthStore } from '@/shared/stores/authStore';
import { useMaintenanceStore } from '@/shared/stores/maintenanceStore';

const fetchMock = vi.fn();
const location = {
  href: 'https://console.test/ui/acme/',
  origin: 'https://console.test',
};

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', location);
  useAuthStore.setState({ orgId: 'acme' });
  useMaintenanceStore.setState({ isMaintenanceMode: false });
  token.current = 'token-1';
  runtime.isOidcAuth = true;
  location.href = 'https://console.test/ui/acme/';
  resetResponseStatusForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const sentHeaders = () => new Headers(fetchMock.mock.calls[0][1].headers);

describe('runtimeFetch', () => {
  it("calls the tenant's runtime API with the signed-in user's token", async () => {
    await runtimeFetch('/workflows/w1/versions/2/compile', { method: 'POST' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.test/api/runtime/acme/workflows/w1/versions/2/compile'
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(sentHeaders().get('Authorization')).toBe('Bearer token-1');
  });

  it('sends no Authorization header without a token', async () => {
    token.current = undefined;
    await runtimeFetch('/agents');
    expect(sentHeaders().has('Authorization')).toBe(false);
  });

  it("keeps the caller's headers, and its Authorization over the token", async () => {
    await runtimeFetch('/agents', {
      headers: { Accept: 'text/event-stream', Authorization: 'Bearer own' },
    });
    expect(sentHeaders().get('Accept')).toBe('text/event-stream');
    expect(sentHeaders().get('Authorization')).toBe('Bearer own');
  });

  it('hands back a refusal as it is, for the caller to read', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'QUEUE_FULL' }), { status: 429 })
    );
    const response = await runtimeFetch('/signals/i1', { method: 'POST' });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'QUEUE_FULL' });
    expect(location.href).toBe('https://console.test/ui/acme/');
  });

  it('turns maintenance mode on at a 503', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    await runtimeFetch('/agents');
    expect(useMaintenanceStore.getState().isMaintenanceMode).toBe(true);
  });

  it('drops the session and goes to sign in at a 401', async () => {
    localStorage.setItem('oidc.user:idp:console', '{}');
    localStorage.setItem('theme-storage', '{}');
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    await runtimeFetch('/agents');
    expect(localStorage.getItem('oidc.user:idp:console')).toBeNull();
    expect(localStorage.getItem('theme-storage')).toBe('{}');
    expect(useAuthStore.getState().orgId).toBe('');
    expect(location.href).toBe('https://console.test');
  });

  it('leaves a 401 to the caller in an auth mode with no login', async () => {
    runtime.isOidcAuth = false;
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const response = await runtimeFetch('/agents');
    expect(response.status).toBe(401);
    expect(location.href).toBe('https://console.test/ui/acme/');
  });
});

describe('attachAccessToken', () => {
  const request = (url: string, headers: Record<string, string> = {}) => ({
    url,
    headers: new AxiosHeaders(headers),
  });

  it("sends the signed-in user's token with a call to the API", () => {
    const sent = attachAccessToken(request('/api/runtime/workflows'));
    expect(sent.headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('keeps an Authorization header the caller set', () => {
    const sent = attachAccessToken(
      request('/api/runtime/workflows', { Authorization: 'Bearer own' })
    );
    expect(sent.headers.get('Authorization')).toBe('Bearer own');
  });

  it('sends none without a token, or outside the API', () => {
    expect(
      attachAccessToken(request('/health')).headers.has('Authorization')
    ).toBe(false);
    token.current = undefined;
    expect(
      attachAccessToken(request('/api/runtime/workflows')).headers.has(
        'Authorization'
      )
    ).toBe(false);
  });
});

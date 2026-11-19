import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  isOidcAuth: true,
  config: { oidc: { authority: 'https://idp.test', clientId: 'console' } },
}));
vi.mock('@/shared/config/runtimeConfig', () => runtime);

import { currentAccessToken } from './access-token';

const KEY = 'oidc.user:https://idp.test:console';
const stored = (expiresInSeconds: number) =>
  JSON.stringify({
    access_token: 'token-1',
    token_type: 'Bearer',
    profile: { sub: 'user' },
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });

afterEach(() => {
  localStorage.clear();
  runtime.isOidcAuth = true;
});

describe('currentAccessToken', () => {
  it('is the token oidc-client-ts stored for this authority and client', () => {
    localStorage.setItem(KEY, stored(600));
    expect(currentAccessToken()).toBe('token-1');
  });

  it('is undefined when nobody is signed in', () => {
    expect(currentAccessToken()).toBeUndefined();
  });

  it('is undefined past the token expiry', () => {
    localStorage.setItem(KEY, stored(-60));
    expect(currentAccessToken()).toBeUndefined();
  });

  it('is undefined when the stored user cannot be read', () => {
    localStorage.setItem(KEY, 'not json');
    expect(currentAccessToken()).toBeUndefined();
  });

  it('is undefined in an auth mode that sends no token, whatever is stored', () => {
    localStorage.setItem(KEY, stored(600));
    runtime.isOidcAuth = false;
    expect(currentAccessToken()).toBeUndefined();
  });
});

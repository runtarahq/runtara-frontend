import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = vi.hoisted(() => ({ current: 'token-1' as string | undefined }));
vi.mock('@/shared/auth/access-token', () => ({
  currentAccessToken: () => token.current,
}));

import { ServerHTTP } from './index';
import { resetResponseStatusForTests } from './response-status';
import { createBillingPortalSession, getServerHealth } from './server';
import { useMaintenanceStore } from '@/shared/stores/maintenanceStore';

type Sent = { url?: string; method?: string; data?: string; auth?: unknown };
let sent: Sent[] = [];
let answer: { status: number; data: unknown } = { status: 200, data: {} };

beforeEach(() => {
  sent = [];
  answer = { status: 200, data: {} };
  token.current = 'token-1';
  useMaintenanceStore.setState({ isMaintenanceMode: false });
  resetResponseStatusForTests();
  // The request as it leaves the client, after its interceptors.
  ServerHTTP.defaults.adapter = async (config) => {
    sent.push({
      url: config.url,
      method: config.method,
      data: config.data,
      auth: config.headers.get('Authorization'),
    });
    const response = {
      data: answer.data,
      status: answer.status,
      statusText: '',
      headers: {},
      config,
    };
    if (answer.status >= 400) {
      throw Object.assign(new Error(`status ${answer.status}`), { response });
    }
    return response;
  };
});
afterEach(() => {
  delete ServerHTTP.defaults.adapter;
});

describe('getServerHealth', () => {
  it("asks /health, with no token: it is not the API's", async () => {
    answer.data = { version: '10.0.3' };
    expect(await getServerHealth()).toEqual({ version: '10.0.3' });
    expect(sent).toEqual([
      { url: '/health', method: 'get', data: undefined, auth: undefined },
    ]);
  });

  it('answers with no version for a server that names none', async () => {
    answer.data = undefined;
    expect(await getServerHealth()).toEqual({});
  });

  it('rejects, and turns maintenance mode on, when the server is down for it', async () => {
    answer.status = 503;
    await expect(getServerHealth()).rejects.toThrow();
    expect(useMaintenanceStore.getState().isMaintenanceMode).toBe(true);
  });
});

describe('createBillingPortalSession', () => {
  it("opens the portal with the signed-in user's token, to come back to this console", async () => {
    answer.data = { url: 'https://billing.example/session/1' };
    expect(await createBillingPortalSession()).toEqual({
      url: 'https://billing.example/session/1',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: '/api/management/billing-dashboard',
      method: 'post',
      auth: 'Bearer token-1',
    });
    expect(JSON.parse(sent[0].data!)).toEqual({
      return_url: window.location.origin,
    });
  });
});

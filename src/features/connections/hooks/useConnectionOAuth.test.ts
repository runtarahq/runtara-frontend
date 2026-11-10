import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token-1' } }),
}));
vi.mock('@/shared/config/runtimeConfig', () => ({ isOidcAuth: true }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/bootstrap.tsx', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('@/features/connections/queries', () => ({
  getOAuthAuthorizeUrl: async (_token: string, id: string) => `url:${id}`,
}));
vi.mock('./useOAuthPopup', () => ({
  OAuthPopupClosedError: class OAuthPopupClosedError extends Error {},
  useOAuthPopup: () => ({
    openOAuthPopup: (_url: string, id: string) =>
      new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
  }),
}));

import { useConnectionOAuth } from './useConnectionOAuth';

describe('useConnectionOAuth running mark (CN-13)', () => {
  it('keeps the newer flow running when the replaced one settles', async () => {
    const { result } = renderHook(() => useConnectionOAuth());

    let a!: Promise<void>;
    let b!: Promise<void>;
    await act(async () => {
      a = result.current.authorize('conn_a');
      await Promise.resolve();
    });
    await act(async () => {
      b = result.current.authorize('conn_b');
      await Promise.resolve();
    });
    expect(result.current.isAuthorizing('conn_b')).toBe(true);

    // A is replaced and settles while B is still running.
    await act(async () => {
      pending.get('conn_a')!.reject(new Error('replaced'));
      await a;
    });
    expect(result.current.isAuthorizing('conn_b')).toBe(true);

    await act(async () => {
      pending.get('conn_b')!.resolve({ connectionId: 'conn_b', success: true });
      await b;
    });
    expect(result.current.isAuthorizing()).toBe(false);
  });
});

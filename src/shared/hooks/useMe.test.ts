import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const get = vi.fn();
let token = 'token-1';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { access_token: token } }),
}));
vi.mock('@/shared/config/runtimeConfig', () => ({ isOidcAuth: true }));
vi.mock('@/shared/queries', () => ({
  RuntimeREST: { instance: { get: (...args: unknown[]) => get(...args) } },
}));

import { useAuthStore } from '@/shared/stores/authStore.ts';
import { useMe } from './useMe';

describe('useMe (SH-4)', () => {
  it('keeps the known role when a later /me fails', async () => {
    get.mockResolvedValueOnce({
      data: { role: 'viewer', permissions: { 'workflow:read': ['viewer'] } },
    });
    const { rerender } = renderHook(() => useMe());
    await waitFor(() => expect(useAuthStore.getState().role).toBe('viewer'));

    // A silent renew brings a new token, and its /me fails.
    get.mockRejectedValueOnce(new Error('500'));
    token = 'token-2';
    rerender();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAuthStore.getState().role).toBe('viewer');
    expect(useAuthStore.getState().permissions).toEqual({
      'workflow:read': ['viewer'],
    });
  });
});

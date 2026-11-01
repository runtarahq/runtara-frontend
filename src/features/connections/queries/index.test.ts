import { expect, it, vi } from 'vitest';
import { getOAuthAuthorizeUrl } from './index';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/queries', () => ({ RuntimeREST: { instance: { get } } }));
vi.mock('@/shared/queries/utils', () => ({
  createAuthHeaders: (token?: string | null) => ({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }),
}));

it('starts an OAuth flow with credentials, so its browser keeps the flow cookie', async () => {
  get.mockResolvedValue({
    data: { authorizationUrl: 'https://provider.example/authorize?state=s' },
  });
  await expect(getOAuthAuthorizeUrl('token-1', 'conn-1')).resolves.toBe(
    'https://provider.example/authorize?state=s'
  );
  expect(get).toHaveBeenCalledWith(
    '/api/runtime/connections/conn-1/oauth/authorize',
    { headers: { Authorization: 'Bearer token-1' }, withCredentials: true }
  );
});

import { expect, it, vi } from 'vitest';
import { getOAuthAuthorizeUrl } from './index';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/queries', () => ({ RuntimeREST: { instance: { get } } }));

it('starts an OAuth flow with credentials, so its browser keeps the flow cookie', async () => {
  get.mockResolvedValue({
    data: { authorizationUrl: 'https://provider.example/authorize?state=s' },
  });
  await expect(getOAuthAuthorizeUrl('conn-1')).resolves.toBe(
    'https://provider.example/authorize?state=s'
  );
  expect(get).toHaveBeenCalledWith(
    '/api/runtime/connections/conn-1/oauth/authorize',
    { withCredentials: true }
  );
});

import { expect, it, vi } from 'vitest';
import { getOAuthAuthorizeUrl } from './index';

const authorize = vi.hoisted(() => vi.fn());
vi.mock('@/shared/queries', () => ({
  RuntimeREST: { api: { authorizeHandler: authorize } },
}));

it('starts an OAuth flow with credentials, so its browser keeps the flow cookie', async () => {
  authorize.mockResolvedValue({
    data: { authorizationUrl: 'https://provider.example/authorize?state=s' },
  });
  await expect(getOAuthAuthorizeUrl('conn-1')).resolves.toBe(
    'https://provider.example/authorize?state=s'
  );
  expect(authorize).toHaveBeenCalledWith('conn-1', { withCredentials: true });
});

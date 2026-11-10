import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { access_token: 'token-1' },
    signoutRedirect: vi.fn(),
  }),
}));
vi.mock('@/shared/config/runtimeConfig', () => ({ isOidcAuth: true }));
vi.mock('@/shared/queries', () => ({
  RuntimeREST: { instance: { get: (...args: unknown[]) => get(...args) } },
}));
vi.mock('@/shared/config/oidcConfig', () => ({ mountReturnPath: '/ui/' }));
vi.mock('@edition', () => ({ edition: {} }));

import { TenantGate } from './TenantGate';
import { useMyTenantsLookup } from './myTenants';

describe('useMyTenantsLookup (SH-1)', () => {
  beforeEach(() => get.mockReset());

  it('reports a failed lookup, and a retry asks again', async () => {
    get.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useMyTenantsLookup());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.tenants).toBeNull();

    get.mockResolvedValueOnce({
      data: { tenants: [{ id: 'acme', role: 'owner' }] },
    });
    act(() => result.current.retry?.());
    expect(result.current.failed).toBe(false);
    await waitFor(() =>
      expect(result.current.tenants).toEqual([{ id: 'acme', role: 'owner' }])
    );
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('TenantGate after a failed lookup (SH-1)', () => {
  it('says the lookup failed and offers a retry instead of spinning', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <TenantGate tenants={null} failed onRetry={onRetry} />
    );
    expect(screen.getByText('Could not load your workspaces')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the failure at a workspace URL too (SH-2)', () => {
    render(<TenantGate tenants={null} failed deniedTenant="acme" />);
    expect(screen.getByText('Could not load your workspaces')).toBeTruthy();
    expect(screen.queryByText('No access')).toBeNull();
  });

  it('still spins while the lookup is loading', () => {
    render(<TenantGate tenants={null} />);
    expect(screen.queryByText('Could not load your workspaces')).toBeNull();
  });
});

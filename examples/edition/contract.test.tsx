import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// The console built with this example as its edition (`npm run test:edition`):
// each part of `Edition` shows up where src/shared/edition/types.ts says.

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { access_token: 'token-1', profile: {} },
    signoutRedirect: vi.fn(),
  }),
}));

// The sidebar asks for the tenant's entitlements; there is no server here.
vi.mock('@/shared/queries/entitlements', () => ({
  fetchEntitlements: () => new Promise(() => {}),
}));

// jsdom has no matchMedia, which the sidebar asks for its mobile breakpoint.
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
);

import { edition } from '@edition';
import { isOpenPath, openRouter, router } from '@/router';
import { SidebarProvider } from '@/shared/components/ui/sidebar';
import { Sidebar } from '@/shared/layouts/Sidebar';
import { TenantGate } from '@/shared/tenant/TenantGate';
import { edition as example } from './index';

function renderSidebar() {
  const memory = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <SidebarProvider>
            <Sidebar />
          </SidebarProvider>
        ),
      },
    ],
    { initialEntries: ['/workflows'] }
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={memory} />
    </QueryClientProvider>
  );
}

describe('the console built with an edition', () => {
  it('resolves @edition to the directory RUNTARA_EDITION_DIR names', () => {
    expect(edition).toBe(example);
  });

  it('mounts its pages after the built-in ones, behind sign-in', () => {
    const matches = matchRoutes(router.routes, '/billing');
    expect(matches?.at(-1)?.route.path).toBe('/billing');
    // A built-in page still wins its own path.
    expect(matchRoutes(router.routes, '/workflows')?.at(-1)?.route.path).toBe(
      '/workflows'
    );
  });

  it('serves its open pages outside the app layout', () => {
    expect(isOpenPath('/invitations/abc')).toBe(true);
    expect(isOpenPath('/workflows')).toBe(false);
    expect(
      matchRoutes(openRouter().routes, '/invitations/abc')?.at(-1)?.route.path
    ).toBe('/invitations/:token');
  });

  it('shows its menu entry, settings entry and footer control', async () => {
    renderSidebar();
    expect(await screen.findByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(screen.getByLabelText('Help')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('offers its own way in to a user without a workspace', () => {
    render(<TenantGate tenants={[]} />);
    expect(
      screen.getByText('Create a workspace to get started.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ask a workspace owner/)).toBeNull();
  });

  it('answers which tenants the user may open', () => {
    expect(edition.useTenants?.()).toEqual([{ id: 'acme', role: 'owner' }]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { NavigationBlocker } from './NavigationBlocker';
import { useNavigationBlockerStore } from '@/shared/stores/navigationBlockerStore';

describe('NavigationBlocker', () => {
  afterEach(() => useNavigationBlockerStore.getState().reset());

  function renderBlockedRoute() {
    const onDiscard = vi.fn();
    useNavigationBlockerStore.getState().setBlocker(true, onDiscard);
    const router = createMemoryRouter([
      {
        element: (
          <>
            <NavigationBlocker />
            <Outlet />
          </>
        ),
        children: [
          { path: '/', element: <Link to="/next">Leave editor</Link> },
          { path: '/next', element: <p>Destination</p> },
        ],
      },
    ]);
    render(<RouterProvider router={router} />);
    return { router, onDiscard };
  }

  it.each(['Keep editing', 'Escape'])(
    'keeps the current route and releases the modal pointer lock after %s',
    async (action) => {
      const user = userEvent.setup();
      const { router, onDiscard } = renderBlockedRoute();
      await user.click(screen.getByRole('link', { name: 'Leave editor' }));
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(document.body.style.pointerEvents).toBe('none');
      if (action === 'Escape') await user.keyboard('{Escape}');
      else await user.click(screen.getByRole('button', { name: action }));
      await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
      expect(router.state.location.pathname).toBe('/');
      expect(onDiscard).not.toHaveBeenCalled();
    }
  );

  it('discards once and completes navigation when confirmed by keyboard', async () => {
    const user = userEvent.setup();
    const { router, onDiscard } = renderBlockedRoute();
    await user.click(screen.getByRole('link', { name: 'Leave editor' }));
    screen.getByRole('button', { name: 'Discard changes' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/next');
    expect(onDiscard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''));
  });
});

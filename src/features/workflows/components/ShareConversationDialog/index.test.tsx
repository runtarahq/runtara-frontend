import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueToken } from '@/features/workflows/queries/conversations';
import { readSharedChatLink } from '@/features/workflows/utils/shared-chat-link';
import { ShareConversationDialog } from './index';

vi.mock('@/shared/hooks/useToken', () => ({ useToken: () => 'token' }));
vi.mock('@/shared/config/appBase', () => ({
  appBaseUrl: 'https://console.example/ui/acme/',
}));
vi.mock('@/shared/queries/utils', () => ({
  getRuntimeBaseUrl: () => 'https://api.example/api/runtime/acme',
}));
vi.mock('@/features/workflows/queries/conversations', () => ({
  issueToken: vi.fn(),
}));

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShareConversationDialog
        workflowId="workflow"
        conversationKey="console:abc"
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  return onClose;
}

beforeEach(() => {
  vi.mocked(issueToken).mockReset();
  vi.mocked(issueToken).mockResolvedValue({
    token: 'rtc_secret',
    expiresAt: '2026-11-21T06:00:00Z',
  });
});
afterEach(cleanup);

describe('ShareConversationDialog', () => {
  it('says what a link gives and that it cannot be withdrawn, before making one', () => {
    renderDialog();
    expect(screen.getByText(/without an account/)).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be withdrawn once it is made/)
    ).toBeInTheDocument();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('makes a link for the lifetime chosen, with a sender of its own', async () => {
    renderDialog();
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: String(24 * 3600) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));

    const field = (await screen.findByLabelText('Link')) as HTMLInputElement;
    const [, workflowId, key, request] = vi.mocked(issueToken).mock.calls[0];
    expect([workflowId, key]).toEqual(['workflow', 'console:abc']);
    expect(request).toMatchObject({
      ttlSeconds: 86400,
      sender: { name: 'Guest' },
    });

    const link = new URL(field.value);
    expect(link.pathname).toBe('/ui/acme/shared-chat');
    expect(readSharedChatLink(link.hash)).toEqual({
      workflowId: 'workflow',
      key: 'console:abc',
      token: 'rtc_secret',
      org: 'acme',
      sender: request?.sender?.id,
      expiresAt: '2026-11-21T06:00:00Z',
    });
    // How long it lasts, since nothing withdraws it sooner.
    expect(
      screen.getByText(/It works until .*cannot be\s+withdrawn/)
    ).toBeInTheDocument();
    // Made once: there is no second link to make by mistake.
    expect(
      screen.queryByRole('button', { name: 'Create link' })
    ).not.toBeInTheDocument();
  });

  it('copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy the link' })
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/shared-chat#')
      )
    );
  });
});

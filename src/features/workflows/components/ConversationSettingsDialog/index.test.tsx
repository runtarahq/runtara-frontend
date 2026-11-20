import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConversation,
  openConversation,
} from '@/features/workflows/queries/conversations';
import { ConversationSettingsDialog } from './index';

vi.mock('@/shared/hooks/useToken', () => ({ useToken: () => 'token' }));
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token' } }),
}));
vi.mock('@/features/workflows/queries', () => ({
  getWorkflows: vi.fn().mockResolvedValue({
    data: {
      content: [
        { id: 'wf-chat', name: 'Chat workflow' },
        { id: 'wf-relay', name: 'Relay to Slack' },
      ],
    },
  }),
}));
vi.mock('@/features/workflows/queries/conversations', () => ({
  getConversation: vi.fn(),
  openConversation: vi.fn(),
}));

const standing = (fields: object = {}) => ({
  id: 'id',
  key: 'slack:C1',
  workflowId: 'wf-chat',
  createdAt: 'now',
  updatedAt: 'now',
  lastSeq: 0,
  queued: 0,
  replyEvents: ['reply', 'waiting_for_input'],
  ...fields,
});

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationSettingsDialog
        workflowId="wf-chat"
        conversationKey="slack:C1"
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  return onClose;
}

const picker = () =>
  screen.findByRole('combobox', {
    name: 'Reply workflow',
  }) as Promise<HTMLSelectElement>;

beforeEach(() => {
  // Radix's checkbox measures itself; jsdom has no ResizeObserver.
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  vi.mocked(getConversation).mockReset();
  vi.mocked(openConversation).mockReset();
});
afterEach(cleanup);

describe('ConversationSettingsDialog', () => {
  it('shows the reply workflow and the events it is started for', async () => {
    vi.mocked(getConversation).mockResolvedValue(
      standing({ replyWorkflowId: 'wf-relay' })
    );
    renderDialog();
    await waitFor(async () => expect((await picker()).value).toBe('wf-relay'));
    expect(screen.getByRole('checkbox', { name: 'Each reply' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'When a run ends' })
    ).not.toBeChecked();
  });

  it('sets a reply workflow and adds an event', async () => {
    vi.mocked(getConversation).mockResolvedValue(standing());
    vi.mocked(openConversation).mockResolvedValue(standing());
    const onClose = renderDialog();
    const select = await picker();
    await screen.findByRole('option', { name: 'Relay to Slack' });
    fireEvent.change(select, { target: { value: 'wf-relay' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'When a run ends' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(openConversation).toHaveBeenCalledWith(
        'token',
        'wf-chat',
        'slack:C1',
        {
          replyWorkflowId: 'wf-relay',
          replyEvents: ['reply', 'waiting_for_input', 'run_ended'],
        }
      )
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('removes the reply workflow by sending null', async () => {
    vi.mocked(getConversation).mockResolvedValue(
      standing({ replyWorkflowId: 'wf-relay' })
    );
    vi.mocked(openConversation).mockResolvedValue(standing());
    renderDialog();
    const select = await picker();
    await waitFor(() => expect(select.value).toBe('wf-relay'));
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(vi.mocked(openConversation).mock.calls[0][3]).toMatchObject({
        replyWorkflowId: null,
      })
    );
  });

  it('keeps a reply workflow that is not among those listed', async () => {
    vi.mocked(getConversation).mockResolvedValue(
      standing({ replyWorkflowId: 'wf-gone' })
    );
    renderDialog();
    await waitFor(async () => expect((await picker()).value).toBe('wf-gone'));
  });
});

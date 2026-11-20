import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@/generated/RuntaraRuntimeApi';
import {
  deleteConversation,
  listConversations,
  openConversation,
} from '@/features/workflows/queries/conversations';
import { conversationName } from './conversation-name';
import { ConversationList } from './index';

const auth = vi.hoisted(() => ({ token: 'token', isOidcAuth: true }));
vi.mock('@/shared/hooks/useToken', () => ({ useToken: () => auth.token }));
vi.mock('@/shared/config/runtimeConfig', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/config/runtimeConfig')>();
  return {
    ...actual,
    get isOidcAuth() {
      return auth.isOidcAuth;
    },
  };
});
vi.mock('@/features/workflows/queries/conversations', () => ({
  deleteConversation: vi.fn(),
  listConversations: vi.fn(),
  openConversation: vi.fn(),
}));

const conversation = (
  key: string,
  fields: Partial<ConversationSummary> = {}
): ConversationSummary => ({
  id: key,
  key,
  active: false,
  waiting: false,
  createdAt: '2026-11-20T05:00:00Z',
  updatedAt: '2026-11-20T05:00:00Z',
  ...fields,
});

function renderList(
  props: Partial<Parameters<typeof ConversationList>[0]> = {}
) {
  const handlers = {
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onRenamed: vi.fn(),
    onDeleted: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConversationList
        workflowId="workflow"
        activeKey={null}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>
  );
  return handlers;
}

const rows = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('button span')?.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  auth.token = 'token';
  auth.isOidcAuth = true;
  vi.mocked(listConversations).mockResolvedValue({ conversations: [] });
});
afterEach(cleanup);

describe('ConversationList', () => {
  it('names a conversation by its title, else the last thing said, else its key', () => {
    expect(conversationName(conversation('k', { title: 'Named' }))).toBe(
      'Named'
    );
    expect(
      conversationName(
        conversation('k', {
          lastSaid: { kind: 'reply', text: 'Last said', at: 'now' },
        })
      )
    ).toBe('Last said');
    expect(conversationName(conversation('slack:C1'))).toBe('slack:C1');
  });

  it('lists conversations in the order given, page after page', async () => {
    vi.mocked(listConversations)
      .mockResolvedValueOnce({
        conversations: [
          conversation('a', { title: 'Newest', active: true, waiting: true }),
          conversation('b', { title: 'Older', active: true }),
        ],
        next: 'page-2',
      })
      .mockResolvedValueOnce({
        conversations: [conversation('c', { title: 'Oldest' })],
      });
    const { onOpen } = renderList({ activeKey: 'b' });

    await waitFor(() => expect(rows()).toEqual(['Newest', 'Older']));
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Older/ })).toHaveAttribute(
      'aria-current',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toEqual(['Newest', 'Older', 'Oldest']));
    expect(vi.mocked(listConversations).mock.calls[1][2]).toMatchObject({
      cursor: 'page-2',
    });
    // The last page: there is no more to ask for.
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Oldest/ }));
    expect(onOpen).toHaveBeenCalledWith('c');
  });

  it('narrows to the conversations this console started', async () => {
    renderList();
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(1));
    expect(vi.mocked(listConversations).mock.calls[0][2]).toMatchObject({
      prefix: undefined,
    });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(vi.mocked(listConversations).mock.lastCall?.[2]).toMatchObject({
        prefix: 'console:',
      })
    );
  });

  it('renames a conversation and reads the list again', async () => {
    const user = userEvent.setup();
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation('a', { title: 'Before' })],
    });
    vi.mocked(openConversation).mockResolvedValue({} as never);
    const { onRenamed } = renderList();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Before' })
    );
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    const input = await screen.findByLabelText('Title');
    await user.clear(input);
    await user.type(input, 'After');
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation('a', { title: 'After' })],
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(openConversation).toHaveBeenCalledWith('token', 'workflow', 'a', {
        title: 'After',
      })
    );
    expect(onRenamed).toHaveBeenCalledWith('a', 'After');
    await waitFor(() => expect(rows()).toEqual(['After']));
  });

  it('removes a title that is emptied', async () => {
    const user = userEvent.setup();
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation('a', { title: 'Before' })],
    });
    vi.mocked(openConversation).mockResolvedValue({} as never);
    renderList();
    await user.click(
      await screen.findByRole('button', { name: 'Actions for Before' })
    );
    await user.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    await user.clear(await screen.findByLabelText('Title'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(openConversation).toHaveBeenCalledWith('token', 'workflow', 'a', {
        title: null,
      })
    );
  });

  it('deletes a conversation only after it is confirmed, and reads the list again', async () => {
    const user = userEvent.setup();
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation('a', { title: 'Doomed' })],
    });
    vi.mocked(deleteConversation).mockResolvedValue();
    const { onDeleted } = renderList();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Doomed' })
    );
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    // What deleting takes with it is said before it is done.
    expect(
      await screen.findByText(/Everything said in “Doomed” is deleted with it/)
    ).toBeInTheDocument();
    expect(deleteConversation).not.toHaveBeenCalled();

    vi.mocked(listConversations).mockResolvedValue({ conversations: [] });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteConversation).toHaveBeenCalledWith('token', 'workflow', 'a')
    );
    expect(onDeleted).toHaveBeenCalledWith('a');
    expect(
      await screen.findByText('No conversations yet.')
    ).toBeInTheDocument();
  });

  it('lists without a token where the server needs none, and waits for one where it does', async () => {
    auth.token = '';
    renderList();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Signed in through OIDC, but the token is not there yet.
    expect(listConversations).not.toHaveBeenCalled();
    cleanup();

    auth.isOidcAuth = false;
    renderList();
    expect(
      await screen.findByText('No conversations yet.')
    ).toBeInTheDocument();
    expect(listConversations).toHaveBeenCalledTimes(1);
  });
});

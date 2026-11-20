import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowDto } from '@/generated/RuntaraRuntimeApi';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import { ChatPage } from './index';

const mocks = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
  getWorkflowInstance: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  openConversation: vi.fn(),
  readBack: vi.fn(),
  sendConversationMessage: vi.fn(),
  streamConversationEvents: vi.fn(),
  fetchChatHistory: vi.fn(),
}));

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'test-token' } }),
}));

vi.mock('@/features/workflows/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workflows/queries')>()),
  getWorkflow: mocks.getWorkflow,
  getWorkflowInstance: mocks.getWorkflowInstance,
}));

vi.mock('@/features/workflows/queries/chat', () => ({
  fetchChatHistory: mocks.fetchChatHistory,
}));

vi.mock(
  '@/features/workflows/queries/conversations',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/features/workflows/queries/conversations')
    >()),
    getConversation: mocks.getConversation,
    listConversations: mocks.listConversations,
    openConversation: mocks.openConversation,
    readBack: mocks.readBack,
    sendMessage: mocks.sendConversationMessage,
    streamEvents: mocks.streamConversationEvents,
  })
);

const WORKFLOW_ID = 'wf-chat';
const INSTANCE_ID = 'inst-chat';

function buildWorkflow(supportsChat: boolean): WorkflowDto {
  return {
    id: WORKFLOW_ID,
    name: 'Probe workflow',
    description: '',
    created: '2026-07-27T10:00:00.000Z',
    updated: '2026-07-27T10:00:00.000Z',
    currentVersionNumber: 1,
    lastVersionNumber: 1,
    executionGraph: {},
    inputSchema: {},
    outputSchema: {},
    path: '/',
    supportsChat,
  } as unknown as WorkflowDto;
}

/** Where the page is now, for a test to read. */
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderChat(instanceId?: string, conversationKey?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const entry = conversationKey
    ? `/workflows/${WORKFLOW_ID}/chat/c/${conversationKey}`
    : instanceId
      ? `/workflows/${WORKFLOW_ID}/chat/${instanceId}`
      : `/workflows/${WORKFLOW_ID}/chat`;

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route path="/workflows/:workflowId/chat" element={<ChatPage />} />
          <Route
            path="/workflows/:workflowId/chat/c/:conversationKey"
            element={<ChatPage />}
          />
          <Route
            path="/workflows/:workflowId/chat/:instanceId"
            element={<ChatPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.getState().resetChat();
  mocks.openConversation.mockResolvedValue({ key: 'opened', lastSeq: 0 });
  mocks.readBack.mockResolvedValue([]);
  mocks.getConversation.mockResolvedValue({ key: 'k', lastSeq: 0, queued: 0 });
  mocks.listConversations.mockResolvedValue({ conversations: [] });
  mocks.sendConversationMessage.mockResolvedValue({
    messageId: 'opening',
    state: 'started',
    duplicate: false,
  });
  // A stream with nothing on it yet: enough to prove the conversation was
  // opened without standing up a real one.
  mocks.streamConversationEvents.mockResolvedValue(
    new ReadableStream({ start() {} })
  );
  mocks.getWorkflowInstance.mockResolvedValue({ inputs: { data: {} } });
  mocks.fetchChatHistory.mockResolvedValue([]);
});

describe('ChatPage on a workflow that cannot chat', () => {
  it('explains the dead end instead of starting a conversation', async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(false) });

    renderChat();

    expect(
      await screen.findByText('This workflow does not support chat')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/needs a step that waits for your reply/i)
    ).toBeInTheDocument();

    // The composer is gone, so there is nothing to type into and lose.
    expect(
      screen.queryByPlaceholderText('Type a message...')
    ).not.toBeInTheDocument();
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
  });

  it('does not start a conversation while the workflow is still loading', async () => {
    // Never resolves — the page must not start anything on an assumption.
    mocks.getWorkflow.mockReturnValue(new Promise(() => {}));

    renderChat();

    await waitFor(() => {
      expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
    });
    expect(
      screen.queryByText('This workflow does not support chat')
    ).not.toBeInTheDocument();
  });

  it('still resumes an existing run, which may be holding a pending input', async () => {
    // Invocation History links here for a run waiting on a reply. If the
    // workflow lost its wait step since that run started, the transcript and
    // the composer must survive — refusing here would strand the reply.
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(false) });

    renderChat(INSTANCE_ID);

    await waitFor(() => {
      expect(mocks.fetchChatHistory).toHaveBeenCalledWith(
        'test-token',
        WORKFLOW_ID,
        INSTANCE_ID
      );
    });
    expect(
      screen.queryByText('This workflow does not support chat')
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Type a message...')
    ).toBeInTheDocument();
    // Resuming attaches to the existing run rather than starting another.
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
  });
});

describe('ChatPage on a chat-capable workflow', () => {
  it('starts a conversation under a key of its own and offers the composer', async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });

    renderChat();

    await waitFor(() => {
      expect(mocks.sendConversationMessage).toHaveBeenCalledWith(
        'test-token',
        WORKFLOW_ID,
        expect.stringMatching(/^console:/),
        expect.objectContaining({ payload: {} }),
        expect.anything()
      );
    });
    expect(
      screen.queryByText('This workflow does not support chat')
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Type a message...')
    ).toBeInTheDocument();
  });
});

describe('ChatPage and the conversation it shows', () => {
  const location = () => screen.getByTestId('location').textContent;

  it("takes the conversation's URL once it has started one, without starting another", async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });

    renderChat();

    await waitFor(() =>
      expect(location()).toMatch(
        new RegExp(`^/workflows/${WORKFLOW_ID}/chat/c/console(:|%3A)`)
      )
    );
    await waitFor(() =>
      expect(mocks.sendConversationMessage).toHaveBeenCalledTimes(1)
    );
    // The same chat under its own URL: opened once, read once.
    expect(mocks.openConversation).toHaveBeenCalledTimes(1);
    expect(mocks.streamConversationEvents).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().conversationKey).toMatch(/^console:/);
  });

  it('reopens a conversation by its key, sending nothing', async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });

    renderChat(undefined, 'console%3Aabc');

    await waitFor(() =>
      expect(mocks.streamConversationEvents).toHaveBeenCalledWith(
        'test-token',
        WORKFLOW_ID,
        'console:abc',
        expect.objectContaining({ after: 0 })
      )
    );
    expect(mocks.openConversation).not.toHaveBeenCalled();
    expect(mocks.sendConversationMessage).not.toHaveBeenCalled();
    expect(
      screen.getByRole('status', { name: 'Loading the conversation' })
    ).toBeInTheDocument();
  });

  it('shows a run a conversation started as that conversation', async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });
    mocks.getWorkflowInstance.mockResolvedValue({
      inputs: { data: { conversation: { key: 'slack:C1' } } },
    });

    renderChat(INSTANCE_ID);

    await waitFor(() =>
      expect(location()).toMatch(/\/chat\/c\/slack(:|%3A)C1$/)
    );
    await waitFor(() =>
      expect(mocks.streamConversationEvents).toHaveBeenCalledWith(
        'test-token',
        WORKFLOW_ID,
        'slack:C1',
        expect.anything()
      )
    );
    expect(mocks.fetchChatHistory).not.toHaveBeenCalled();
  });

  it("lists the workflow's conversations and opens the one chosen", async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });
    mocks.listConversations.mockResolvedValue({
      conversations: [
        {
          id: '1',
          key: 'slack:C1',
          title: 'From Slack',
          active: false,
          waiting: false,
          createdAt: '2026-11-20T05:00:00Z',
          updatedAt: '2026-11-20T05:00:00Z',
        },
      ],
    });

    renderChat(undefined, 'console%3Aabc');

    fireEvent.click(await screen.findByRole('button', { name: /^From Slack/ }));
    await waitFor(() =>
      expect(location()).toMatch(/\/chat\/c\/slack(:|%3A)C1$/)
    );
    // Another conversation: what was shown is replaced by it.
    await waitFor(() =>
      expect(mocks.readBack).toHaveBeenLastCalledWith(
        'test-token',
        WORKFLOW_ID,
        'slack:C1',
        expect.anything(),
        expect.anything()
      )
    );
    expect(useChatStore.getState().conversationKey).toBe('slack:C1');
  });

  it('shows what is said, and what the runs did only when asked', async () => {
    mocks.getWorkflow.mockResolvedValue({ data: buildWorkflow(true) });
    const at = '2026-11-20T06:00:00Z';
    // Newest first, as the log is read back.
    mocks.readBack.mockResolvedValue([
      { seq: 3, kind: 'reply', body: { text: 'Found it.' }, createdAt: at },
      {
        seq: 2,
        kind: 'activity',
        body: { type: 'tool_call', tool_name: 'lookup' },
        createdAt: at,
      },
      {
        seq: 1,
        kind: 'run_started',
        body: { instanceId: 'run-1', messageId: 'm' },
        createdAt: at,
      },
    ]);
    mocks.streamConversationEvents.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: caught_up\ndata: {"kind":"caught_up","body":{"lastSeq":3}}\n\n'
            )
          );
        },
      })
    );
    mocks.getConversation.mockResolvedValue({
      key: 'k',
      lastSeq: 3,
      queued: 0,
    });

    renderChat(undefined, 'console%3Aabc');

    expect(await screen.findByText('Found it.')).toBeInTheDocument();
    expect(screen.queryByText('Calling tool: lookup')).not.toBeInTheDocument();
    expect(screen.queryByText('Execution started')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show what the runs did' })
    );
    expect(screen.getByText('Calling tool: lookup')).toBeInTheDocument();
    expect(screen.getByText('Execution started')).toBeInTheDocument();
  });
});

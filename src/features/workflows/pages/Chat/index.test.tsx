import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowDto } from '@/generated/RuntaraRuntimeApi';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import { ChatPage } from './index';

const mocks = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
  getWorkflowInstance: vi.fn(),
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

vi.mock('@/features/workflows/queries/chat', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/workflows/queries/chat')
  >()),
  sendConversationMessage: mocks.sendConversationMessage,
  streamConversationEvents: mocks.streamConversationEvents,
  fetchChatHistory: mocks.fetchChatHistory,
}));

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

function renderChat(instanceId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const entry = instanceId
    ? `/workflows/${WORKFLOW_ID}/chat/${instanceId}`
    : `/workflows/${WORKFLOW_ID}/chat`;

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/workflows/:workflowId/chat" element={<ChatPage />} />
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
  mocks.sendConversationMessage.mockResolvedValue({
    messageId: 'opening',
    state: 'started',
    duplicate: false,
  });
  // A stream with nothing on it yet: enough to prove the conversation was
  // opened without standing up a real one.
  mocks.streamConversationEvents.mockResolvedValue({
    body: new ReadableStream({ start() {} }),
  } as unknown as Response);
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

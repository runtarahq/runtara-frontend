import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import {
  ConversationError,
  getConversation,
  openConversation,
  readBack,
  sendMessage,
  stopConversation,
  streamEvents,
} from '@/features/workflows/queries/conversations';
import { getPendingInput } from '@/features/workflows/queries';
import { SharedChatPage } from './index';

vi.mock('@/features/workflows/queries', () => ({
  getPendingInput: vi.fn(),
  deliverSignal: vi.fn(),
}));
vi.mock(
  '@/features/workflows/queries/conversations',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/features/workflows/queries/conversations')
    >()),
    getConversation: vi.fn(),
    openConversation: vi.fn(),
    readBack: vi.fn(),
    sendMessage: vi.fn(),
    stopConversation: vi.fn(),
    streamEvents: vi.fn(),
  })
);

const chat = {
  workflowId: 'workflow',
  key: 'console:abc',
  token: 'rtc_token',
  sender: 'link:1',
  expiresAt: '2026-11-21T06:00:00Z',
};

const said = (seq: number, body: Record<string, unknown>, kind = 'message') =>
  ({ seq, kind, body, createdAt: '2026-11-20T06:00:00Z' }) as never;

/** A stream that says it has caught up, and then nothing. */
function caughtUp() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'event: caught_up\ndata: {"kind":"caught_up","body":{"lastSeq":2}}\n\n'
        )
      );
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.getState().resetChat();
  vi.mocked(streamEvents).mockImplementation(async () => caughtUp());
  vi.mocked(getConversation).mockResolvedValue({
    id: 'id',
    key: chat.key,
    workflowId: chat.workflowId,
    title: 'Order 1042',
    createdAt: 'now',
    updatedAt: 'now',
    instanceId: 'run-1',
    lastSeq: 2,
    queued: 0,
    replyEvents: [],
  });
  // Newest first, as the log is read back.
  vi.mocked(readBack).mockResolvedValue([
    said(2, { text: 'It ships on Monday.' }, 'reply'),
    said(1, {
      id: 'm1',
      text: 'Where is my order?',
      sender: { id: 'link:1', name: 'Guest' },
    }),
  ]);
});
afterEach(() => {
  cleanup();
  useChatStore.getState().setSelf(null);
});

describe('SharedChatPage', () => {
  it('says so when the link is not whole, and asks the server nothing', () => {
    render(<SharedChatPage chat={null} />);
    expect(screen.getByText('This link is not complete')).toBeInTheDocument();
    expect(readBack).not.toHaveBeenCalled();
    expect(streamEvents).not.toHaveBeenCalled();
  });

  it("shows the conversation with the link's token, and nothing else of the console", async () => {
    render(<SharedChatPage chat={chat} />);
    expect(await screen.findByText('It ships on Monday.')).toBeInTheDocument();
    expect(await screen.findByText('Order 1042')).toBeInTheDocument();
    // This page's own message, not someone else's.
    expect(screen.getByText('Where is my order?')).toBeInTheDocument();
    expect(screen.queryByText('Guest')).not.toBeInTheDocument();
    expect(screen.getByText(/This link works until/)).toBeInTheDocument();

    for (const call of [readBack, streamEvents, getConversation]) {
      expect(vi.mocked(call).mock.calls[0].slice(0, 3)).toEqual([
        'rtc_token',
        'workflow',
        'console:abc',
      ]);
    }
    // Only what a conversation token is taken by.
    expect(openConversation).not.toHaveBeenCalled();
    expect(getPendingInput).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('complementary', { name: 'Conversations' })
    ).not.toBeInTheDocument();
  });

  it('sends a message and stops the run with the token', async () => {
    vi.mocked(sendMessage).mockImplementation(
      async (_token, _workflow, _key, message) => ({
        messageId: message.id,
        state: 'queued',
        duplicate: false,
      })
    );
    vi.mocked(stopConversation).mockResolvedValue({ cleared: 0 });
    render(<SharedChatPage chat={chat} />);
    const input = await screen.findByPlaceholderText('Type a message...');
    fireEvent.change(input, { target: { value: 'Thanks' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(vi.mocked(sendMessage).mock.calls[0].slice(0, 3)).toEqual([
        'rtc_token',
        'workflow',
        'console:abc',
      ])
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(stopConversation).toHaveBeenCalledWith(
        'rtc_token',
        'workflow',
        'console:abc',
        { clearQueue: false }
      )
    );
  });

  it('says when the link is no longer taken, and offers nothing to send', async () => {
    const refused = new ConversationError(
      'Invalid or expired conversation token',
      undefined,
      401
    );
    vi.mocked(readBack).mockRejectedValue(refused);
    vi.mocked(streamEvents).mockRejectedValue(refused);
    render(<SharedChatPage chat={chat} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link has expired or is not valid'
    );
    expect(
      screen.queryByPlaceholderText('Type a message...')
    ).not.toBeInTheDocument();
  });
});

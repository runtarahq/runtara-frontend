import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/features/workflows/types/chat';
import { ChatBubble } from './index';

function message(fields: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'line',
    role: 'assistant',
    content: '',
    timestamp: 'now',
    events: [],
    ...fields,
  };
}

afterEach(cleanup);

describe('ChatBubble', () => {
  it("names the sender of a message that is not this page's user's", () => {
    render(
      <ChatBubble
        message={message({ role: 'user', content: 'Hi', sender: 'Olena' })}
      />
    );
    expect(screen.getByText('Olena')).toBeInTheDocument();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('renders a Markdown reply as Markdown and a plain one as it is', () => {
    render(<ChatBubble message={message({ content: 'Some **bold**' })} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    cleanup();
    render(
      <ChatBubble
        message={message({ content: 'Not **bold**', format: 'plain' })}
      />
    );
    expect(screen.getByText('Not **bold**')).toBeInTheDocument();
  });

  it("shows a reply's data when asked, and its attachments as links", () => {
    render(
      <ChatBubble
        message={message({
          content: 'Here.',
          data: { stage: 1 },
          attachments: [
            { name: 'report.pdf', url: 'https://files/report.pdf' },
            { name: 'odd', url: 'javascript:alert(1)' },
          ],
        })}
      />
    );
    expect(screen.queryByText(/"stage": 1/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    expect(screen.getByText(/"stage": 1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'report.pdf' })).toHaveAttribute(
      'href',
      'https://files/report.pdf'
    );
    // Named, but not a link to follow.
    expect(screen.getByText('odd').tagName).toBe('SPAN');
  });

  it('shows a reply that carries only data', () => {
    render(<ChatBubble message={message({ data: [1, 2] })} />);
    expect(screen.getByRole('button', { name: /Data/ })).toBeInTheDocument();
  });

  it('says of a message that it waits its turn, or why it was not taken', () => {
    render(
      <ChatBubble
        message={message({ role: 'user', content: 'Hi', queued: true })}
      />
    );
    expect(screen.getByText('Queued')).toBeInTheDocument();
    cleanup();
    render(
      <ChatBubble
        message={message({ role: 'user', content: 'Hi', failure: 'too late' })}
      />
    );
    expect(screen.getByText(/Not delivered: too late/)).toBeInTheDocument();
  });
});

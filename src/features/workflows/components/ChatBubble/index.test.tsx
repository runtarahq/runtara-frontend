import { cleanup, render, screen } from '@testing-library/react';
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
});

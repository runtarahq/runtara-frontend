import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/features/workflows/types/chat';
import { ChatMessageList } from './index';

const line = (id: string): ChatMessage => ({
  id,
  role: 'user',
  content: id,
  timestamp: 'now',
  events: [],
});

afterEach(cleanup);

describe('ChatMessageList', () => {
  it('offers earlier messages only where there are some', () => {
    const onLoadEarlier = vi.fn();
    const { rerender } = render(
      <ChatMessageList messages={[line('a')]} onLoadEarlier={onLoadEarlier} />
    );
    expect(
      screen.queryByRole('button', { name: /Load earlier/ })
    ).not.toBeInTheDocument();
    rerender(
      <ChatMessageList
        messages={[line('a')]}
        hasEarlier
        onLoadEarlier={onLoadEarlier}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Load earlier/ }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it('asks for earlier messages when scrolled to the top, once at a time', () => {
    const onLoadEarlier = vi.fn();
    const { rerender, container } = render(
      <ChatMessageList
        messages={[line('a')]}
        hasEarlier
        onLoadEarlier={onLoadEarlier}
      />
    );
    const list = container.firstElementChild!;
    fireEvent.scroll(list, { target: { scrollTop: 0 } });
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    rerender(
      <ChatMessageList
        messages={[line('a')]}
        hasEarlier
        loadingEarlier
        onLoadEarlier={onLoadEarlier}
      />
    );
    fireEvent.scroll(list, { target: { scrollTop: 0 } });
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Load earlier/ })).toBeDisabled();
  });

  it('holds the place being read when messages are added above it', () => {
    const { rerender, container } = render(
      <ChatMessageList messages={[line('c'), line('d')]} hasEarlier />
    );
    const list = container.firstElementChild as HTMLElement;
    let height = 500;
    Object.defineProperty(list, 'scrollHeight', { get: () => height });
    // Measured as it stands, before more is added.
    rerender(<ChatMessageList messages={[line('c'), line('d')]} hasEarlier />);
    list.scrollTop = 10;
    height = 800;
    rerender(
      <ChatMessageList
        messages={[line('a'), line('b'), line('c'), line('d')]}
        hasEarlier
      />
    );
    expect(list.scrollTop).toBe(310);
  });
});

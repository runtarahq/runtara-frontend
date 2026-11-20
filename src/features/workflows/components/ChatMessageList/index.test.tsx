import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/features/workflows/types/chat';
import { ChatMessageList } from './index';

const line = (id: string): ChatMessage => ({
  id,
  role: 'user',
  content: id,
  timestamp: 'now',
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
    const list = container.querySelector('.overflow-y-auto')!;
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
    const list = container.querySelector('.overflow-y-auto') as HTMLElement;
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

  describe('following the conversation', () => {
    const scrolled = vi.fn();
    const place = (list: HTMLElement, fromEnd: number) => {
      Object.defineProperty(list, 'scrollHeight', {
        configurable: true,
        get: () => 1000,
      });
      Object.defineProperty(list, 'clientHeight', {
        configurable: true,
        get: () => 400,
      });
      fireEvent.scroll(list, { target: { scrollTop: 600 - fromEnd } });
    };
    const reply = (id: string): ChatMessage => ({
      ...line(id),
      role: 'assistant',
    });

    it('follows new messages while the reader is at the end', () => {
      Element.prototype.scrollIntoView = scrolled;
      scrolled.mockClear();
      const { rerender } = render(<ChatMessageList messages={[reply('a')]} />);
      scrolled.mockClear();
      rerender(<ChatMessageList messages={[reply('a'), reply('b')]} />);
      expect(scrolled).toHaveBeenCalledTimes(1);
    });

    it('leaves a reader who scrolled up where they are, and offers the way back', () => {
      Element.prototype.scrollIntoView = scrolled;
      const { rerender, container } = render(
        <ChatMessageList messages={[reply('a')]} />
      );
      place(container.querySelector('.overflow-y-auto') as HTMLElement, 300);
      scrolled.mockClear();
      rerender(<ChatMessageList messages={[reply('a'), reply('b')]} />);
      expect(scrolled).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole('button', { name: 'Go to the latest message' })
      );
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('button', { name: 'Go to the latest message' })
      ).not.toBeInTheDocument();
    });

    it('shows what the reader says themself, wherever they were reading', () => {
      Element.prototype.scrollIntoView = scrolled;
      const { rerender, container } = render(
        <ChatMessageList messages={[reply('a')]} />
      );
      place(container.querySelector('.overflow-y-auto') as HTMLElement, 300);
      scrolled.mockClear();
      rerender(<ChatMessageList messages={[reply('a'), line('mine')]} />);
      expect(scrolled).toHaveBeenCalledTimes(1);
    });

    it('shows that a run is working before it has said anything', () => {
      render(<ChatMessageList messages={[]} working />);
      expect(
        screen.getByRole('status', { name: 'Working' })
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Start a conversation')
      ).not.toBeInTheDocument();
    });
  });
});

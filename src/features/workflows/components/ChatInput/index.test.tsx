import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './index';
vi.mock('./ChatFormInput', () => ({
  ChatFormInput: () => <div>Structured response</div>,
}));
afterEach(cleanup);
const input = { requestId: 'request', signalId: 'signal', message: 'Question' };
const props = () => ({
  status: 'waiting_for_input' as const,
  waitingForInput: input,
  pendingInputs: [input],
  onSend: vi.fn().mockResolvedValue(false),
  onSelectInput: vi.fn(),
  onSubmitInput: vi.fn(),
});
describe('chat response drafts', () => {
  it('retains text on uncertain failure and clears it only after confirmation', async () => {
    const options = props();
    const { rerender } = render(<ChatInput {...options} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'My answer' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() =>
      expect(options.onSend).toHaveBeenCalledWith('My answer')
    );
    expect(screen.getByRole('textbox')).toHaveValue('My answer');
    options.onSend.mockResolvedValue(true);
    rerender(<ChatInput {...options} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });
  it('never carries a stale response into the next target', () => {
    const options = props();
    const { rerender } = render(<ChatInput {...options} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Old answer' },
    });
    rerender(
      <ChatInput
        {...options}
        waitingForInput={{ ...input, requestId: 'next' }}
      />
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(options.onSend).not.toHaveBeenCalled();
  });
  it('requires an explicit selection for ambiguous requests', () => {
    const options = props();
    render(
      <ChatInput
        {...options}
        waitingForInput={null}
        pendingInputs={[
          input,
          { ...input, requestId: 'next', message: 'Second question' },
        ]}
      />
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Second question' }));
    expect(options.onSelectInput).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'next' })
    );
    expect(options.onSend).not.toHaveBeenCalled();
  });
  it('takes a message while a run is busy: it waits its turn', async () => {
    const options = {
      ...props(),
      status: 'streaming' as const,
      waitingForInput: null,
      pendingInputs: [],
      onSend: vi.fn().mockResolvedValue(true),
    };
    render(<ChatInput {...options} />);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByText(/waits its turn/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'One more thing' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() =>
      expect(options.onSend).toHaveBeenCalledWith('One more thing')
    );
  });

  describe('typed in as a chat is', () => {
    const chat = () => ({
      ...props(),
      status: 'idle' as const,
      waitingForInput: null,
      pendingInputs: [],
    });
    const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

    it('has the focus when it opens, and keeps it while a message is sent', async () => {
      let taken!: (accepted: boolean) => void;
      const options = {
        ...chat(),
        onSend: vi.fn(
          () => new Promise<boolean>((resolve) => (taken = resolve))
        ),
      };
      render(<ChatInput {...options} />);
      expect(box()).toHaveFocus();
      fireEvent.change(box(), { target: { value: 'Hello' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      // Gone from the box at once, which stays usable: the next message is
      // typed while this one is on its way.
      expect(box()).toHaveValue('');
      expect(box()).toBeEnabled();
      expect(box()).toHaveFocus();
      fireEvent.change(box(), { target: { value: 'And another' } });
      taken(true);
      await waitFor(() => expect(options.onSend).toHaveBeenCalledTimes(1));
      expect(box()).toHaveValue('And another');
    });

    it('puts a message that was not taken back, unless more was typed', async () => {
      const options = { ...chat(), onSend: vi.fn().mockResolvedValue(false) };
      render(<ChatInput {...options} />);
      fireEvent.change(box(), { target: { value: 'Lost?' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      await waitFor(() => expect(box()).toHaveValue('Lost?'));
    });

    it('makes a new line with Shift+Enter, and does not send a word being composed', () => {
      const options = { ...chat(), onSend: vi.fn().mockResolvedValue(true) };
      render(<ChatInput {...options} />);
      fireEvent.change(box(), { target: { value: 'One' } });
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
      fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
      expect(options.onSend).not.toHaveBeenCalled();
      expect(box()).toHaveValue('One');
    });

    it('keeps what was typed ahead when the run then asks for a message', () => {
      const options = { ...chat(), status: 'streaming' as const };
      const { rerender } = render(<ChatInput {...options} />);
      fireEvent.change(box(), { target: { value: 'Typed while it worked' } });
      rerender(
        <ChatInput
          {...options}
          status="waiting_for_input"
          waitingForInput={input}
          pendingInputs={[input]}
        />
      );
      expect(box()).toHaveValue('Typed while it worked');
    });

    it('offers to stop a busy run where the send button is, until something is typed', () => {
      const options = {
        ...chat(),
        status: 'streaming' as const,
        onStop: vi.fn(),
      };
      render(<ChatInput {...options} />);
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      expect(options.onStop).toHaveBeenCalledTimes(1);
      fireEvent.change(box(), { target: { value: 'Wait' } });
      expect(
        screen.queryByRole('button', { name: 'Stop' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('offers no stop when nothing runs', () => {
      render(<ChatInput {...chat()} onStop={vi.fn()} />);
      expect(
        screen.queryByRole('button', { name: 'Stop' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });
  });
});

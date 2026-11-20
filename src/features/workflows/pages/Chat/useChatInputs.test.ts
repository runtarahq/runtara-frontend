import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatInputs } from './useChatInputs';
import { useChatStore } from '../../stores/chatStore';
import { deliverSignal, getPendingInput } from '../../queries';
import { InputSubmissionError } from '../../utils/input-submission';

vi.mock('../../queries', () => ({
  deliverSignal: vi.fn(),
  getPendingInput: vi.fn(),
}));
const request = {
  requestedAt: '2026-09-25T00:00:00Z',
  requestId: 'request',
  signalId: 'diagnostic',
  message: 'Answer',
  responseSchema: { message: { type: 'string' } },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.getState().resetChat();
  // A run that no conversation started, opened from its history.
  useChatStore.getState().resumeChat('workflow', 'Workflow', 'instance');
  vi.mocked(getPendingInput).mockResolvedValue([request]);
});
afterEach(() => {
  cleanup();
  useChatStore.getState().resetChat();
});

describe('authoritative chat input discovery and acceptance', () => {
  it('retains exact payloads and operations for an uncertain original reply after editing', async () => {
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await waitFor(() =>
      expect(useChatStore.getState().pendingInputs).toHaveLength(1)
    );
    vi.mocked(deliverSignal).mockRejectedValue(
      new TypeError('lost acknowledgement')
    );
    await act(() =>
      result.current.submitInput('request', { message: 'Original' }, 'instance')
    );
    await act(() =>
      result.current.submitInput('request', { message: 'Edited' }, 'instance')
    );
    expect(result.current.uncertainResponses).toHaveLength(2);
    const original = result.current.uncertainResponses[0];
    const originalCall = vi.mocked(deliverSignal).mock.calls[0];
    vi.mocked(getPendingInput).mockResolvedValue([]);
    vi.mocked(deliverSignal).mockResolvedValueOnce({
      receiptId: 'receipt',
      requestId: 'request',
      acceptedAt: 'now',
    });
    await act(() =>
      result.current.submitInput(
        'request',
        original.payload,
        original.instanceId,
        original.operationId
      )
    );
    expect(vi.mocked(deliverSignal).mock.calls[2]).toEqual(originalCall);
    expect(result.current.uncertainResponses).toHaveLength(1);
  });
  it('discovers without SSE, retains explicit selection, and clears only on a successful empty result', async () => {
    vi.mocked(getPendingInput).mockResolvedValue([
      request,
      { ...request, requestId: 'second' },
    ]);
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await waitFor(() =>
      expect(useChatStore.getState().pendingInputs).toHaveLength(2)
    );
    expect(useChatStore.getState().waitingForInput).toBeNull();
    act(() =>
      useChatStore
        .getState()
        .setWaitingForInput(useChatStore.getState().pendingInputs[0])
    );
    await act(() => result.current.refreshPendingInput());
    expect(useChatStore.getState().waitingForInput?.requestId).toBe('request');
    vi.mocked(getPendingInput).mockRejectedValueOnce(
      new Error('Discovery unavailable')
    );
    await act(() => result.current.refreshPendingInput());
    expect(useChatStore.getState().pendingInputError).toBe(
      'Discovery unavailable'
    );
    expect(useChatStore.getState().pendingInputs).toHaveLength(2);
    vi.mocked(getPendingInput).mockResolvedValue([]);
    await act(() => result.current.refreshPendingInput());
    expect(useChatStore.getState().pendingInputs).toEqual([]);
    expect(useChatStore.getState().waitingForInput).toBeNull();
    expect(useChatStore.getState().pendingInputError).toBeNull();
  });

  it('ignores a delayed snapshot after switching executions', async () => {
    const old = deferred<(typeof request)[]>();
    vi.mocked(getPendingInput).mockReturnValueOnce(old.promise);
    renderHook(() => useChatInputs('workflow', 'token'));
    vi.mocked(getPendingInput).mockResolvedValue([]);
    act(() =>
      useChatStore.getState().resumeChat('workflow', 'Workflow', 'replacement')
    );
    await act(async () => {
      old.resolve([request]);
    });
    expect(useChatStore.getState().pendingInputs).toEqual([]);
    expect(useChatStore.getState().instanceId).toBe('replacement');
  });

  it('rejects older overlapping refreshes even within the same execution', async () => {
    const old = deferred<(typeof request)[]>();
    vi.mocked(getPendingInput).mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    vi.mocked(getPendingInput).mockResolvedValue([]);
    await act(() => result.current.refreshPendingInput());
    await act(async () => {
      old.resolve([request]);
    });
    expect(useChatStore.getState().pendingInputs).toEqual([]);
  });

  it('retains a lost-ack form and replays the exact operation after discovery excludes acceptance', async () => {
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await waitFor(() =>
      expect(useChatStore.getState().waitingForInput).not.toBeNull()
    );
    vi.mocked(deliverSignal).mockRejectedValueOnce(
      new TypeError('network lost')
    );
    vi.mocked(getPendingInput).mockResolvedValue([]);
    let accepted;
    await act(async () => {
      accepted = await result.current.submitInput('request', {
        message: 'Yes',
      });
    });
    expect(accepted).toBe(false);
    await act(() => result.current.refreshPendingInput());
    expect(useChatStore.getState().waitingForInput?.requestId).toBe('request');
    vi.mocked(deliverSignal).mockResolvedValueOnce({
      receiptId: 'receipt',
      requestId: 'request',
      acceptedAt: 'now',
    });
    await act(async () => {
      accepted = await result.current.submitInput('request', {
        message: 'Yes',
      });
    });
    expect(accepted).toBe(true);
    expect(vi.mocked(deliverSignal).mock.calls[1][2]).toEqual(
      vi.mocked(deliverSignal).mock.calls[0][2]
    );
    expect(useChatStore.getState().pendingInputs).toEqual([]);
  });

  it('clears a stale target without delivering it to another request', async () => {
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await waitFor(() =>
      expect(useChatStore.getState().waitingForInput).not.toBeNull()
    );
    vi.mocked(getPendingInput).mockResolvedValue([
      { ...request, requestId: 'second' },
    ]);
    vi.mocked(deliverSignal).mockRejectedValueOnce(
      new InputSubmissionError(
        'Already answered',
        'INPUT_ALREADY_ANSWERED',
        409
      )
    );
    await act(() => result.current.submitInput('request', { message: 'Yes' }));
    await waitFor(() =>
      expect(useChatStore.getState().waitingForInput?.requestId).toBe('second')
    );
    expect(deliverSignal).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().error).toBe('Already answered');
  });

  it('drops every uncertain retry once its request closed unanswered', async () => {
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await waitFor(() =>
      expect(useChatStore.getState().pendingInputs).toHaveLength(1)
    );
    vi.mocked(deliverSignal).mockRejectedValueOnce(
      new TypeError('lost acknowledgement')
    );
    await act(() =>
      result.current.submitInput('request', { message: 'First' }, 'instance')
    );
    expect(result.current.uncertainResponses).toHaveLength(1);
    // The request then times out; discovery no longer lists it.
    vi.mocked(getPendingInput).mockResolvedValue([]);
    vi.mocked(deliverSignal).mockRejectedValueOnce(
      new InputSubmissionError('Input closed', 'INPUT_INACTIVE', 409)
    );
    await act(() =>
      result.current.submitInput('request', { message: 'Second' }, 'instance')
    );
    expect(result.current.uncertainResponses).toEqual([]);
    await act(() => result.current.refreshPendingInput());
    expect(useChatStore.getState().pendingInputs).toEqual([]);
  });

  it('neither polls nor answers for a chat that has a conversation', async () => {
    useChatStore.getState().setConversationKey('conversation');
    const { result } = renderHook(() => useChatInputs('workflow', 'token'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(await result.current.refreshPendingInput()).toBe(false);
    expect(getPendingInput).not.toHaveBeenCalled();
    // What the conversation announced is answered through it, not here.
    useChatStore.getState().setPendingInputs([request]);
    expect(
      await result.current.submitInput('request', { message: 'Yes' })
    ).toBe(false);
    expect(deliverSignal).not.toHaveBeenCalled();
  });
});

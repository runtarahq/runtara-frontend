import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverSignal, getPendingInput } from './index';
import { sendConversationMessage } from './chat';
import { InputSubmissionError } from '../utils/input-submission';

vi.mock('@/shared/queries', () => ({ RuntimeREST: { api: {} } }));
const submission = {
  requestId: 'request',
  operationId: 'operation',
  payload: { answer: true },
};
const receipt = {
  requestId: 'request',
  receiptId: 'receipt',
  acceptedAt: 'now',
};
afterEach(() => vi.unstubAllGlobals());

describe('managed input HTTP contract', () => {
  it('sends a message under its own id and rejects an answer for another', async () => {
    const message = { id: 'message', text: 'Hello' };
    const data = { messageId: 'message', state: 'queued', duplicate: false };
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ success: true, data }))
      );
    vi.stubGlobal('fetch', fetch);
    expect(await sendConversationMessage('workflow', 'a key', message)).toEqual(
      data
    );
    expect(fetch.mock.calls[0][0]).toContain(
      '/workflows/workflow/conversations/a%20key/messages'
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(message);
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { ...data, messageId: 'wrong' } })
      )
    );
    await expect(
      sendConversationMessage('workflow', 'a key', message)
    ).rejects.toThrow('could not be confirmed');
  });
  it('reports a full conversation with its code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            code: 'CONVERSATION_QUEUE_FULL',
            message: 'the conversation already holds 32 messages',
          }),
          { status: 429 }
        )
      )
    );
    await expect(
      sendConversationMessage('workflow', 'key', { id: 'm' })
    ).rejects.toMatchObject({
      code: 'CONVERSATION_QUEUE_FULL',
      status: 429,
    } satisfies Partial<InputSubmissionError>);
  });
  it('sends stable request and operation IDs and returns only a confirmed receipt', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: receipt }))
      );
    vi.stubGlobal('fetch', fetch);
    expect(await deliverSignal('instance', submission)).toEqual(receipt);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(submission);
    expect(fetch.mock.calls[0][1].body).not.toContain('checkpointId');
  });
  it('preserves typed stale conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 'INPUT_INACTIVE', message: 'Closed' }),
            { status: 409 }
          )
        )
    );
    await expect(deliverSignal('instance', submission)).rejects.toMatchObject({
      code: 'INPUT_INACTIVE',
      status: 409,
    });
  });
  it('does not acknowledge a malformed or mismatched success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { ...receipt, requestId: 'different' },
          })
        )
      )
    );
    await expect(deliverSignal('instance', submission)).rejects.toBeInstanceOf(
      InputSubmissionError
    );
  });
  it('unwraps the same authoritative pending page for session and execution callers', async () => {
    const data = {
      instanceId: 'instance',
      pendingInputs: [{ requestId: 'request' }],
      count: 1,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ success: true, data }))
        )
    );
    expect(await getPendingInput('workflow', 'instance')).toEqual(
      data.pendingInputs
    );
  });
  it('does not interpret malformed discovery as an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ success: false }))
        )
    );
    await expect(getPendingInput('workflow', 'instance')).rejects.toThrow(
      'Invalid pending input response'
    );
  });
});

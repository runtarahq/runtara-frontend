import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.fn<(request: unknown, label?: string) => Promise<void>>(
  async () => {}
);

vi.mock('@/shared/forms', () => ({
  FormRenderer: () => null,
  analyzeFormWithRust: async () => ({ valid: true, fields: {} }),
}));
vi.mock('@/features/workflows/utils/form-schema-adapter', () => ({
  useWorkflowFormDefinition: () => ({
    definition: { fields: { decision: {} } },
    loading: false,
    error: null,
  }),
  initialWorkflowFormValues: () => ({}),
  workflowFormPayload: (_definition: unknown, values: unknown) => values,
}));
vi.mock('@/features/workflows/hooks/useManagedInputSubmissions', () => ({
  useManagedInputSubmissions: () => ({ inputs: [], submit }),
}));
vi.mock('../answer-options', async () => ({
  ...(await vi.importActual('../answer-options')),
  inlineOptions: () => ({ field: 'decision', values: ['approve', 'reject'] }),
}));

import { QueueAnswer, UNDO_MS, type AnswerController } from './QueueAnswer';

const row = {
  workflowId: 'wf',
  instanceId: 'inst',
  requestId: 'req_b',
  runLabel: 'RUN-b',
  inputSchema: {},
} as never;

beforeEach(() => submit.mockClear());

describe('QueueAnswer (OP-4)', () => {
  it('sends one answer when two choices land in one task', async () => {
    const ref = createRef<AnswerController>();
    render(
      <MemoryRouter>
        <QueueAnswer ref={ref} row={row} inline="decision" infer />
      </MemoryRouter>
    );
    await act(async () => {
      await Promise.all([
        ref.current!.choose('approve'),
        ref.current!.choose('reject'),
      ]);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      payload: { decision: 'approve' },
    });
  });
});

describe('QueueAnswer one-click answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const view = () =>
    render(
      <MemoryRouter>
        <QueueAnswer row={row} inline="decision" infer />
      </MemoryRouter>
    );
  const click = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it('holds a clicked answer until its undo window has passed', async () => {
    view();
    await click('Approve');
    expect(screen.getByRole('status')).toHaveTextContent('Sending “Approve”…');
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({
      payload: { decision: 'approve' },
    });
  });

  it('sends nothing when the answer is undone, and offers the choices again', async () => {
    view();
    await click('Reject');
    await click('Undo');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_MS * 2);
    });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('sends a chosen answer when its row leaves the page before the window ends', async () => {
    const { unmount } = view();
    await click('Approve');
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

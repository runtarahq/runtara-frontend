import { createRef } from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('../answer-options', () => ({
  inlineOptions: () => ({ field: 'decision', values: ['approve', 'reject'] }),
}));

import { QueueAnswer, type AnswerController } from './QueueAnswer';

const row = {
  workflowId: 'wf',
  instanceId: 'inst',
  requestId: 'req_b',
  runLabel: 'RUN-b',
  inputSchema: {},
} as never;

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

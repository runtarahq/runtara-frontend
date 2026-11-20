import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const form = vi.hoisted(() => ({
  definition: { fields: {} as Record<string, unknown> },
}));

vi.mock('@/shared/forms', () => ({
  FormRenderer: () => <input aria-label="City" />,
  analyzeFormWithRust: async () => ({ valid: true, fields: {} }),
}));
vi.mock('@/features/workflows/utils/form-schema-adapter', () => ({
  useWorkflowFormDefinition: () => ({
    definition: form.definition,
    loading: false,
    error: null,
  }),
  initialWorkflowFormValues: () => ({}),
}));

import { ChatFormInput } from './ChatFormInput';

const request = {
  requestId: 'request',
  instanceId: 'run',
  message: 'Deploy to production?',
};

function renderRequest(fields: Record<string, unknown>, asked = request) {
  form.definition = { fields };
  const onSubmit = vi.fn().mockResolvedValue(true);
  render(<ChatFormInput waitingForInput={asked} onSubmit={onSubmit} />);
  return onSubmit;
}

beforeEach(() => vi.clearAllMocks());

describe('what a run asks, where the message box is', () => {
  it('asks for a go-ahead with two buttons, and sends the one pressed', async () => {
    const onSubmit = renderRequest({ approved: { type: 'boolean' } });
    expect(
      screen.getByRole('heading', { name: 'Deploy to production?' })
    ).toBeInTheDocument();
    // Nothing is under the cursor of someone who was still typing.
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'request',
        { approved: false },
        'run',
        'Approved: No'
      )
    );
  });

  it('asks a yes or no question in those words', async () => {
    const onSubmit = renderRequest({ gift_wrap: { type: 'boolean' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'request',
        { gift_wrap: true },
        'run',
        'Gift Wrap: Yes'
      )
    );
  });

  it('offers a few options as a list, and sends the one chosen', async () => {
    const onSubmit = renderRequest({
      size: { type: 'string', enum: ['small', 'large'] },
    });
    fireEvent.click(screen.getByRole('button', { name: /large/ }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'request',
        { size: 'large' },
        'run',
        'Size: large'
      )
    );
  });

  it('shows a form for anything else: its first field has the focus, and Enter sends it', async () => {
    const onSubmit = renderRequest(
      { city: { type: 'string' }, nights: { type: 'number' } },
      { ...request, message: 'Where to?', toolName: 'ask_traveller' } as never
    );
    expect(screen.getByText('Asked by ask_traveller')).toBeInTheDocument();
    const city = screen.getByRole('textbox', { name: 'City' });
    await waitFor(() => expect(city).toHaveFocus());
    fireEvent.keyDown(city, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });
});

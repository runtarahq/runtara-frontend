import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { TriggerForm, type TriggerSchemaType } from '.';
import { initialValues } from './TriggerItem';

// The default HTTP trigger type renders WebhookConnectionField, which would
// otherwise reach for connections over the network.
vi.mock('@/features/connections/hooks/useConnections', () => ({
  useConnections: () => ({ data: [], isLoading: false }),
}));

const WORKFLOWS = [
  { id: 'wf-1', name: 'Orders sync' },
  { id: 'wf-2', name: 'Inventory reconcile' },
];

function renderForm(initValues?: TriggerSchemaType) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TriggerForm
          title="Create trigger"
          fieldProps={{ workflows: WORKFLOWS }}
          initValues={initValues}
          onSubmit={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const workflowCombobox = () =>
  screen.getByRole('combobox', { name: 'Workflow' });

describe('TriggerForm workflow field', () => {
  beforeAll(() => {
    // Radix's Select trigger measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it('prompts for a selection while no workflow is chosen', () => {
    renderForm();

    expect(workflowCombobox()).toHaveTextContent('Select a workflow');
  });

  it('shows the bound workflow name once one is chosen', () => {
    renderForm({ ...initialValues, workflowId: 'wf-2' } as TriggerSchemaType);

    expect(workflowCombobox()).toHaveTextContent('Inventory reconcile');
  });

  it('offers to wait for the workflow on an HTTP trigger only', () => {
    const name = 'Wait for the workflow and answer with its result';
    renderForm({
      ...initialValues,
      triggerType: 'HTTP',
      httpSynchronous: true,
    } as TriggerSchemaType);
    expect(screen.getByRole('switch', { name })).toBeChecked();
    expect(
      screen.getByText(/httpResponse \{status, headers, body\}/)
    ).toBeVisible();
  });

  it('does not offer to wait for the workflow on an email trigger', () => {
    renderForm({
      ...initialValues,
      triggerType: 'EMAIL',
    } as TriggerSchemaType);
    expect(
      screen.queryByRole('switch', {
        name: 'Wait for the workflow and answer with its result',
      })
    ).not.toBeInTheDocument();
    // The settings the two share are still there.
    expect(screen.getByRole('switch', { name: 'Debug mode' })).toBeVisible();
  });
});

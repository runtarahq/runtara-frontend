import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { hasDirtyFields } from '../dirty-state';
import { NodeFormContext } from '../NodeFormContext';
import { NameField } from './index';

vi.mock('@/shared/hooks/api', () => ({
  useCustomQuery: () => ({ data: [] }),
}));

let staged: unknown;

function Harness() {
  const methods = useForm({
    defaultValues: { name: 'First', stepType: 'Log' } as Record<
      string,
      unknown
    >,
  });
  staged = methods.watch('renameStepTo');
  const dirty = hasDirtyFields(methods.formState.dirtyFields);
  return (
    <TooltipProvider>
      <NodeFormContext.Provider
        value={{ agents: [], nodeId: 'first' } as never}
      >
        <FormProvider {...methods}>
          <NameField name="name" />
          <output data-testid="dirty">{String(dirty)}</output>
        </FormProvider>
      </NodeFormContext.Provider>
    </TooltipProvider>
  );
}

function rename(to: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit step id' }));
  fireEvent.change(screen.getByLabelText('Step id'), {
    target: { value: to },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm step id' }));
}

describe('step id rename in the panel (ED-4, ED-5)', () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetState();
    useWorkflowStore
      .getState()
      .addNode({ id: 'first', stepType: 'Log', name: 'First' } as never, {
        x: 0,
        y: 0,
      });
  });

  it('stages the rename in the form and leaves the store alone', () => {
    render(<Harness />);
    rename('renamed');
    expect(staged).toBe('renamed');
    expect(screen.getByTestId('dirty').textContent).toBe('true');
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual([
      'first',
    ]);
    expect(screen.getByText('Renamed from first when you save.')).toBeTruthy();
  });

  it('clears the staged rename when renamed back to the saved id', () => {
    render(<Harness />);
    rename('renamed');
    rename('first');
    expect(staged).toBeUndefined();
  });
});

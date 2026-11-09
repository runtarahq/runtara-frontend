import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { hasDirtyFields } from '../dirty-state';
import { NodeFormContext } from '../NodeFormContext';
import { SwitchCasesField } from './index';

const ctx = {
  previousSteps: [],
  inputSchemaFields: [],
  variables: [],
  isInsideSplit: false,
  isInsideWaitScope: false,
  splitItemSchemaFields: [],
  nodeId: 'sw',
  agents: [],
  workflows: [],
  stepTypes: [],
};

const mapping = [
  { type: 'value', value: 'x', typeHint: 'string', valueType: 'immediate' },
  {
    type: 'cases',
    value: [{ matchType: 'exact', match: 'orig', output: 'o' }],
    typeHint: 'json',
  },
];

function Harness() {
  // `values` resets the form after mount, as NodeForm's reset effect does;
  // before mount the field's useWatch only sees its own empty default.
  const methods = useForm({
    defaultValues: { inputMapping: mapping },
    values: { inputMapping: mapping },
  });
  const dirty = hasDirtyFields(methods.formState.dirtyFields);
  return (
    <TooltipProvider>
      <NodeFormContext.Provider value={ctx as never}>
        <FormProvider {...methods}>
          <SwitchCasesField name="inputMapping" label="Cases" />
          <output data-testid="dirty">{String(dirty)}</output>
        </FormProvider>
      </NodeFormContext.Provider>
    </TooltipProvider>
  );
}

describe('SwitchCasesField dirty state (ED-11)', () => {
  it('starts clean', () => {
    render(<Harness />);
    expect(screen.getByTestId('dirty').textContent).toBe('false');
  });

  it('marks the form dirty when a case is added', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('switch-add-case'));
    expect(screen.getByTestId('dirty').textContent).toBe('true');
  });

  it('marks the form dirty when a case match is edited', () => {
    render(<Harness />);
    const match = screen.getByTestId('switch-case-match-0');
    fireEvent.change(match, { target: { value: 'CHANGED' } });
    fireEvent.blur(match);
    expect(screen.getByTestId('dirty').textContent).toBe('true');
  });
});

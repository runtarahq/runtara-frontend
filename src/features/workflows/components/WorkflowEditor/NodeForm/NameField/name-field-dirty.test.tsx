import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { hasDirtyFields } from '../dirty-state';
import { NodeFormContext } from '../NodeFormContext';
import { NameField } from './index';

vi.mock('@/shared/hooks/api', () => ({
  useCustomQuery: () => ({
    data: [{ id: 'conn_b', title: 'Connection B' }],
  }),
}));

// The real pickers list the catalog; these offer one choice each.
vi.mock('../CapabilityPickerModal', () => ({
  CapabilityPickerModal: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (agentId: string, capabilityId: string) => void;
  }) =>
    open ? (
      <>
        <button type="button" onClick={() => onSelect('audit', 'cap-a')}>
          same capability
        </button>
        <button type="button" onClick={() => onSelect('audit', 'cap-b')}>
          pick cap-b
        </button>
        <button type="button" onClick={() => onSelect('other', 'cap-o')}>
          pick other agent
        </button>
      </>
    ) : null,
}));

vi.mock('../ConnectionPickerModal', () => ({
  ConnectionPickerModal: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (id: string) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onSelect('conn_b')}>
        pick connection B
      </button>
    ) : null,
}));

const agents = [
  {
    id: 'audit',
    name: 'Audit Agent',
    supportsConnections: true,
    supportedCapabilities: {},
  },
  {
    id: 'other',
    name: 'Other Agent',
    supportsConnections: true,
    supportedCapabilities: {},
  },
];

const step = {
  name: 'Agent Step',
  stepType: 'Agent',
  agentId: 'audit',
  capabilityId: 'cap-a',
  connectionId: 'conn_a',
  inputMapping: [{ type: 'x', value: '1' }],
};

function Harness() {
  const methods = useForm({ defaultValues: step });
  const dirty = hasDirtyFields(methods.formState.dirtyFields);
  return (
    <TooltipProvider>
      <NodeFormContext.Provider value={{ agents, nodeId: '' } as never}>
        <FormProvider {...methods}>
          <NameField name="name" />
          <output data-testid="dirty">{String(dirty)}</output>
        </FormProvider>
      </NodeFormContext.Provider>
    </TooltipProvider>
  );
}

const dirty = () => screen.getByTestId('dirty').textContent;
const subtitle = () => screen.getByTitle(/→/);

describe('NameField dirty state (ED-12)', () => {
  it('marks the form dirty when the connection changes', () => {
    render(<Harness />);
    expect(dirty()).toBe('false');
    fireEvent.click(screen.getByTitle('Select connection'));
    fireEvent.click(screen.getByText('pick connection B'));
    expect(screen.getByTitle('Connection B')).toBeTruthy();
    expect(dirty()).toBe('true');
  });

  it('marks the form dirty when the capability changes', () => {
    render(<Harness />);
    fireEvent.click(subtitle());
    fireEvent.click(screen.getByText('pick cap-b'));
    expect(subtitle().textContent).toContain('cap-b');
    expect(dirty()).toBe('true');
  });

  it('marks the form dirty when the agent changes', () => {
    render(<Harness />);
    fireEvent.click(subtitle());
    fireEvent.click(screen.getByText('pick other agent'));
    expect(subtitle().textContent).toContain('Other Agent');
    expect(dirty()).toBe('true');
  });

  it('stays clean when the current capability is re-selected', () => {
    render(<Harness />);
    fireEvent.click(subtitle());
    fireEvent.click(screen.getByText('same capability'));
    expect(dirty()).toBe('false');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FieldList, type FieldConfig } from './FieldList';
import { FormShell } from './FormShell';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: z.string(),
  active: z.boolean(),
  token: z.string(),
});
type Values = z.infer<typeof schema>;

const fields: FieldConfig[] = [
  { type: 'text', name: 'name', label: 'Name', colSpan: 'full' },
  {
    type: 'checkbox',
    name: 'active',
    label: 'Active',
    description: 'Runs on its schedule',
  },
  { type: 'hidden', name: 'token' },
  {
    name: 'kind',
    label: 'Kind',
    renderFormField: (config) => <p>custom field for {String(config.name)}</p>,
  },
  { type: 'custom', label: 'Divider', renderComponent: () => <hr /> },
  { label: 'Nothing to draw', renderComponent: () => null },
];

function Harness({
  onSubmit,
  onInvalid,
  name = '',
}: {
  onSubmit: (values: Values) => void;
  onInvalid?: () => void;
  name?: string;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name, kind: 'a', active: true, token: 'secret' },
  });
  return (
    <FormShell
      form={form}
      onSubmit={onSubmit}
      onInvalid={onInvalid}
      className="shell"
    >
      <FieldList fields={fields} />
      <button type="submit">Save</button>
    </FormShell>
  );
}

// The switch measures itself; jsdom has nothing to measure with.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

beforeEach(() => vi.clearAllMocks());

describe('FormShell', () => {
  it('submits the validated values', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} name="Nightly" />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'Nightly',
      kind: 'a',
      active: true,
      token: 'secret',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says which field refused a submit instead of doing nothing', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Name is required', {
        description: 'Name',
      })
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves a refused submit to the caller that asks for it', async () => {
    const onInvalid = vi.fn();
    render(<Harness onSubmit={vi.fn()} onInvalid={onInvalid} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onInvalid).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('FieldList', () => {
  it('draws built-in fields, and lets the others draw themselves', () => {
    const { container } = render(<Harness onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByText('Runs on its schedule')).toBeInTheDocument();
    expect(screen.getByText('custom field for kind')).toBeInTheDocument();
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('gives a hidden field a value and no cell, and skips what draws nothing', () => {
    const { container } = render(<Harness onSubmit={vi.fn()} />);

    const hidden = container.querySelector('input[type="hidden"]');
    expect(hidden).toHaveValue('secret');
    expect(hidden?.parentElement).toHaveClass('grid');

    // name (full width), active, kind and the divider: four cells.
    const cells = [...container.querySelectorAll('.grid > div')];
    expect(cells).toHaveLength(4);
    expect(cells[0]).toHaveClass('col-span-full');
    expect(cells[1]).toHaveClass('col-span-1');
  });
});

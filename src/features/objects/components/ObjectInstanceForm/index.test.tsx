import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Instance, Schema } from '@/generated/RuntaraRuntimeApi';
import type { FormAnalysisResult, FormRendererProps } from '@/shared/forms';
import { ObjectInstanceDtoForm } from './index';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  analysis: { valid: true, wasmAvailable: true },
  renderer: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/features/objects/hooks/useObjectRecords.ts', () => ({
  useCreateObjectInstanceDto: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useUpdateObjectInstanceDto: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
}));
// The renderer is tested where it lives; here it reports the analysis the
// test sets and offers one edit.
vi.mock('@/shared/forms', async () => {
  const { useEffect } = await import('react');
  return {
    FormRenderer: (props: FormRendererProps) => {
      mocks.renderer(props);
      const { onAnalysisChange } = props;
      useEffect(() => {
        onAnalysisChange?.(mocks.analysis as FormAnalysisResult);
      }, [onAnalysisChange]);
      return (
        <button
          type="button"
          onClick={() => props.onChange({ ...props.value, title: 'Edited' })}
        >
          edit title
        </button>
      );
    },
  };
});

const schema = {
  id: 'schema-1',
  name: 'Article',
  columns: [
    { name: 'title', type: 'string', nullable: false },
    { name: 'meta', type: 'json' },
  ],
} as unknown as Schema;

const lastProps = () =>
  mocks.renderer.mock.calls.at(-1)![0] as FormRendererProps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.analysis = { valid: true, wasmAvailable: true };
  mocks.create.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
});

describe('ObjectInstanceDtoForm', () => {
  it('draws the type’s columns through the shared form renderer', () => {
    render(
      <ObjectInstanceDtoForm
        objectSchemaDto={schema}
        onSuccess={vi.fn()}
        connectionId="c1"
      />
    );

    expect(Object.keys(lastProps().definition.fields)).toEqual([
      'title',
      'meta',
    ]);
    expect(lastProps().value).toEqual({ title: '', meta: '{}' });
  });

  it('creates a record from the edited values', async () => {
    const onSuccess = vi.fn();
    render(
      <ObjectInstanceDtoForm
        objectSchemaDto={schema}
        onSuccess={onSuccess}
        connectionId="c1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'edit title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Instance' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith({
      schemaId: 'schema-1',
      data: {
        schemaId: 'schema-1',
        properties: { title: 'Edited', meta: {} },
      },
    });
  });

  it('updates the record it was opened on', async () => {
    const record = {
      id: 'r1',
      properties: { title: 'Old', meta: { a: 1 } },
    } as unknown as Instance;
    render(
      <ObjectInstanceDtoForm
        objectSchemaDto={schema}
        record={record}
        onSuccess={vi.fn()}
        connectionId="c1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Instance' }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        schemaId: 'schema-1',
        instanceId: 'r1',
        data: { properties: { title: 'Old', meta: { a: 1 } } },
      })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows the problems instead of saving a form that does not validate', async () => {
    mocks.analysis = { valid: false, wasmAvailable: true };
    render(
      <ObjectInstanceDtoForm
        objectSchemaDto={schema}
        onSuccess={vi.fn()}
        connectionId="c1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Instance' }));

    await waitFor(() => expect(lastProps().submitAttempt).toBe(1));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses to save without a connection', () => {
    render(
      <ObjectInstanceDtoForm objectSchemaDto={schema} onSuccess={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Instance' }));

    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Select a database connection first'
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('cannot be submitted while the validator is unavailable', () => {
    mocks.analysis = { valid: false, wasmAvailable: false };
    render(
      <ObjectInstanceDtoForm
        objectSchemaDto={schema}
        onSuccess={vi.fn()}
        connectionId="c1"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Create Instance' })
    ).toBeDisabled();
  });
});

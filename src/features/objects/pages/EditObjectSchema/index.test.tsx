import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';

import type { Schema } from '@/generated/RuntaraRuntimeApi';
import { EditObjectSchema } from './index';

const query = vi.hoisted(() => ({
  current: {} as {
    data?: Schema;
    isLoading: boolean;
    isPlaceholderData: boolean;
  },
  connectionId: 'conn_a',
  mounts: { count: 0 },
}));

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'schema_1' }),
}));
vi.mock('@/features/objects/hooks/useObjectSchemas', () => ({
  useObjectSchemaDtoById: () => query.current,
  useDeleteObjectSchema: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/objects/hooks/useObjectModelConnectionSelection', () => ({
  useObjectModelConnectionSelection: () => ({
    selectedConnectionId: query.connectionId,
    connectionQuery: '',
  }),
}));
vi.mock('@/features/objects/components/ObjectModelConnectionSelector', () => ({
  ObjectModelConnectionSelector: () => null,
}));
vi.mock('@/shared/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
// Like the real form, this seeds its state from the first schema it receives.
vi.mock('@/features/objects/components/ObjectSchemaForm', () => ({
  ObjectSchemaDtoForm: ({ objectSchemaDto }: { objectSchemaDto: Schema }) => {
    const [seeded] = useState(objectSchemaDto.name);
    useEffect(() => {
      query.mounts.count += 1;
    }, []);
    return <div data-testid="form">{seeded}</div>;
  },
}));

const schema = (name: string) => ({ id: 'schema_1', name }) as Schema;

describe('EditObjectSchema across a connection switch', () => {
  beforeEach(() => {
    query.connectionId = 'conn_a';
    query.mounts.count = 0;
    query.current = {
      data: schema('from A'),
      isLoading: false,
      isPlaceholderData: false,
    };
  });

  it('does not show the previous connection schema while the new one loads', () => {
    const { rerender } = render(<EditObjectSchema />);
    expect(screen.getByTestId('form')).toHaveTextContent('from A');

    query.connectionId = 'conn_b';
    query.current = {
      data: schema('from A'),
      isLoading: false,
      isPlaceholderData: true,
    };
    rerender(<EditObjectSchema />);

    expect(screen.queryByTestId('form')).toBeNull();
  });

  it('seeds a fresh form from the new connection schema', () => {
    const { rerender } = render(<EditObjectSchema />);

    query.connectionId = 'conn_b';
    query.current = {
      data: schema('from B'),
      isLoading: false,
      isPlaceholderData: false,
    };
    rerender(<EditObjectSchema />);

    expect(screen.getByTestId('form')).toHaveTextContent('from B');
    expect(query.mounts.count).toBe(2);
  });

  it('keeps the same form across a refetch on the same connection', () => {
    const { rerender } = render(<EditObjectSchema />);

    query.current = {
      data: schema('refetched'),
      isLoading: false,
      isPlaceholderData: false,
    };
    rerender(<EditObjectSchema />);

    expect(screen.getByTestId('form')).toHaveTextContent('from A');
    expect(query.mounts.count).toBe(1);
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token-1' } }),
}));

import { keepPreviousData, keepPreviousWithin, useCustomQuery } from './api';

const wrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

/** Answers after a tick, so the moment between two keys can be observed. */
const answer = (value: string) =>
  new Promise<string>((resolve) => setTimeout(() => resolve(value), 20));

describe('useCustomQuery, when its key changes', () => {
  it('shows nothing of the previous key by default', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useCustomQuery({
          queryKey: ['thing', id],
          queryFn: () => answer(`thing ${id}`),
        }),
      { wrapper: wrapper(), initialProps: { id: 'a' } }
    );
    await waitFor(() => expect(result.current.data).toBe('thing a'));

    rerender({ id: 'b' });
    // Not thing a under thing b's name.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe('thing b'));
  });

  it('keeps the previous answer up for a query that asks to', async () => {
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) =>
        useCustomQuery({
          queryKey: ['list', page],
          queryFn: () => answer(`page ${page}`),
          placeholderData: keepPreviousData,
        }),
      { wrapper: wrapper(), initialProps: { page: 1 } }
    );
    await waitFor(() => expect(result.current.data).toBe('page 1'));

    rerender({ page: 2 });
    expect(result.current.data).toBe('page 1');
    expect(result.current.isPlaceholderData).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('page 2'));
  });

  it('keeps the previous answer within one list, and not across two', async () => {
    const { result, rerender } = renderHook(
      ({ schema, page }: { schema: string; page: number }) =>
        useCustomQuery<string>({
          queryKey: ['rows', schema, { page }],
          queryFn: () => answer(`${schema} page ${page}`),
          placeholderData: keepPreviousWithin<string>(['rows', schema]),
        }),
      { wrapper: wrapper(), initialProps: { schema: 'orders', page: 1 } }
    );
    await waitFor(() => expect(result.current.data).toBe('orders page 1'));

    rerender({ schema: 'orders', page: 2 });
    expect(result.current.data).toBe('orders page 1');
    await waitFor(() => expect(result.current.data).toBe('orders page 2'));

    rerender({ schema: 'customers', page: 1 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toBe('customers page 1'));
  });
});

describe('keepPreviousWithin', () => {
  const keep = keepPreviousWithin<string>(['objects', 'instances', null, 's1']);
  const from = (queryKey: unknown[]) => keep('previous', { queryKey });

  it('keeps an answer whose key starts with the scope', () => {
    expect(from(['objects', 'instances', null, 's1', { page: 2 }])).toBe(
      'previous'
    );
  });

  it('compares the parts of the scope by value', () => {
    const byObject = keepPreviousWithin<string>(['list', { folder: '/a' }]);
    expect(
      byObject('previous', { queryKey: ['list', { folder: '/a' }, 3] })
    ).toBe('previous');
    expect(
      byObject('previous', { queryKey: ['list', { folder: '/b' }, 3] })
    ).toBeUndefined();
  });

  it('drops an answer of another scope, and has none without a previous query', () => {
    expect(
      from(['objects', 'instances', null, 's2', { page: 2 }])
    ).toBeUndefined();
    expect(from(['objects', 'instances', 'conn', 's1'])).toBeUndefined();
    expect(keep('previous', undefined)).toBeUndefined();
  });
});

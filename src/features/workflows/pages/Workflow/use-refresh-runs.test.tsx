import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/shared/queries/query-keys';
import { useRefreshRunsOnStatus } from './use-refresh-runs';

function setup(instanceId: string | null, status?: string) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    (props: { id: string | null; status?: string }) =>
      useRefreshRunsOnStatus(props.id, props.status),
    { wrapper, initialProps: { id: instanceId, status } }
  );
  return { ...hook, invalidate };
}

describe('useRefreshRunsOnStatus', () => {
  it('leaves the lists alone while the page has started no run', () => {
    const { invalidate } = setup(null);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refreshes the lists of runs when a run starts', () => {
    const { rerender, invalidate } = setup(null);

    rerender({ id: 'run-1', status: undefined });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.executions.lists(),
    });
  });

  it('refreshes them again each time the run’s status changes, and not otherwise', () => {
    const { rerender, invalidate } = setup('run-1', 'running');
    invalidate.mockClear();

    rerender({ id: 'run-1', status: 'running' });
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ id: 'run-1', status: 'completed' });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

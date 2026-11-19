import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCompilationProgress: vi.fn(),
  toast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/shared/queries/query-client', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token-1' } }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/features/workflows/queries', () => ({
  getCompilationProgress: mocks.getCompilationProgress,
}));

import { queryClient } from '@/shared/queries/query-client';
import { queryKeys } from '@/shared/queries/query-keys';
import { useCompilationWatch } from './use-compilation-watch';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const watch = () => renderHook(() => useCompilationWatch('wf-1'), { wrapper });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  queryClient.clear();
  mocks.getCompilationProgress.mockReset();
  mocks.toast.error.mockReset();
  mocks.toast.warning.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCompilationWatch', () => {
  it('asks for nothing until a version is watched', async () => {
    const { result } = watch();
    await advance(3000);
    expect(mocks.getCompilationProgress).not.toHaveBeenCalled();
    expect(result.current.compilationToolbarStatus).toBeUndefined();
  });

  it('shows the progress of the watched version, and keeps asking while it builds', async () => {
    mocks.getCompilationProgress.mockResolvedValue({
      status: 'compiling',
      stage: 'link',
      stageIndex: 2,
      totalStages: 4,
    });
    const { result } = watch();
    act(() => result.current.setWatchedCompilationVersion(7));
    await advance(100);
    expect(mocks.getCompilationProgress).toHaveBeenCalledWith('wf-1', 7);
    expect(result.current.compilationToolbarStatus).toEqual({
      status: 'compiling',
      stage: 'link',
      stageIndex: 2,
      totalStages: 4,
      message: null,
      errorMessage: null,
    });
    await advance(2100);
    expect(mocks.getCompilationProgress.mock.calls.length).toBeGreaterThan(2);
  });

  it('shows nothing for a build the server does not know yet', async () => {
    mocks.getCompilationProgress.mockResolvedValue({ status: 'unknown' });
    const { result } = watch();
    act(() => result.current.setWatchedCompilationVersion(7));
    await advance(100);
    expect(result.current.compilationToolbarStatus).toBeUndefined();
    expect(result.current.watchedCompilationVersion).toBe(7);
  });

  it('lets go of a build a beat after it succeeds, and of its Rebuilding mark', async () => {
    mocks.getCompilationProgress.mockResolvedValue({ status: 'success' });
    const refetched = vi.spyOn(queryClient, 'refetchQueries');
    const { result } = watch();
    act(() => {
      result.current.setRebuildingVersions([7, 9]);
      result.current.setWatchedCompilationVersion(7);
    });
    await advance(100);
    expect(result.current.compilationToolbarStatus?.status).toBe('success');
    // Long enough to see the check.
    await advance(2000);
    expect(result.current.watchedCompilationVersion).toBe(7);
    await advance(600);
    expect(result.current.watchedCompilationVersion).toBeUndefined();
    expect(result.current.rebuildingVersions).toEqual([9]);
    expect(refetched).toHaveBeenCalledWith({
      queryKey: queryKeys.workflows.versions('wf-1'),
    });
    expect(mocks.toast.error).not.toHaveBeenCalled();
    // A build that ended is not asked about again.
    const calls = mocks.getCompilationProgress.mock.calls.length;
    await advance(3000);
    expect(mocks.getCompilationProgress.mock.calls.length).toBe(calls);
    refetched.mockRestore();
  });

  it('says a build failed, with its error, and keeps it up long enough to read', async () => {
    mocks.getCompilationProgress.mockResolvedValue({
      status: 'failed',
      errorMessage: 'step a: unknown capability',
    });
    const { result } = watch();
    act(() => result.current.setWatchedCompilationVersion(7));
    await advance(100);
    expect(mocks.toast.error).toHaveBeenCalledWith('Compilation failed', {
      description: 'step a: unknown capability',
    });
    await advance(5000);
    expect(result.current.watchedCompilationVersion).toBe(7);
    await advance(3100);
    expect(result.current.watchedCompilationVersion).toBeUndefined();
  });

  it('gives up on a build it cannot follow', async () => {
    mocks.getCompilationProgress.mockRejectedValue(new Error('502'));
    const { result } = watch();
    act(() => {
      result.current.setRebuildingVersions([7]);
      result.current.setWatchedCompilationVersion(7);
    });
    await advance(11_500);
    expect(result.current.watchedCompilationVersion).toBeUndefined();
    expect(result.current.rebuildingVersions).toEqual([]);
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Could not follow the build',
      expect.anything()
    );
  });
});

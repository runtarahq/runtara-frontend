import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkflowWorkflow: vi.fn(),
  getWorkflowVersions: vi.fn(),
}));
vi.mock('@/bootstrap.tsx', async () => {
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
vi.mock('@/features/workflows/queries', () => mocks);

import { queryClient } from '@/bootstrap.tsx';
import { useExecutionStore } from '@/features/workflows/stores/executionStore';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useVersionSelection, useWorkflowLoad } from './use-workflow-load';

const discard = vi.fn();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const load = (workflowId = 'wf-1') =>
  renderHook(
    ({ id }: { id: string }) => {
      const selection = useVersionSelection();
      return { selection, ...useWorkflowLoad(id, selection, discard) };
    },
    { wrapper, initialProps: { id: workflowId } }
  );
// In steps, each flushed through React: a fetch that settles renders, and
// that render's effects start the next one.
const advance = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 25) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
  }
};

const workflow = (version: number, over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    name: `Orders v${version}`,
    currentVersionNumber: 3,
    nodes: [],
    edges: [],
    inputSchemaFields: [],
    ...over,
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  queryClient.clear();
  discard.mockReset();
  useWorkflowStore.getState().resetState();
  mocks.getWorkflowWorkflow
    .mockReset()
    .mockImplementation(async (_id: string, version?: number) =>
      workflow(version ?? 3)
    );
  mocks.getWorkflowVersions.mockReset().mockResolvedValue({
    success: true,
    data: [
      { versionNumber: 3, trackEvents: false },
      { versionNumber: 2, trackEvents: true },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkflowLoad', () => {
  it('loads the workflow, selects its current version, and lists its versions', async () => {
    const { result } = load();
    await advance(200);
    expect(result.current.data.name).toBe('Orders v3');
    expect(result.current.selection.selectedVersion).toBe(3);
    expect(result.current.selection.queryVersion).toBe(3);
    expect(
      result.current.versionsWithDebug.map((v) => v.versionNumber)
    ).toEqual([3, 2]);
  });

  it('builds the input schema of a workflow that has input fields', async () => {
    mocks.getWorkflowWorkflow.mockResolvedValue(
      workflow(3, {
        inputSchemaFields: [
          { name: 'orderId', type: 'string', required: true, description: '' },
        ],
      })
    );
    const { result } = load();
    await advance(200);
    expect(result.current.hasInputSchema).toBe(true);
    expect(Object.keys(result.current.workflowInputSchema)).toEqual([
      'orderId',
    ]);
  });

  it('leaves a freshly loaded workflow clean', async () => {
    load();
    // Loading itself touched the canvas.
    act(() => useWorkflowStore.setState({ isDirty: true }));
    await advance(300);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('keeps an edit made while the workflow was settling', async () => {
    const { result } = load();
    await advance(50);
    expect(result.current.isFetching).toBe(false);
    // Within the 100 ms the page waits before calling the canvas clean.
    act(() =>
      useWorkflowStore.setState({
        isDirty: true,
        nodes: [
          {
            id: 'a',
            position: { x: 0, y: 0 },
            data: { name: 'Edited' },
          },
        ],
      })
    );
    await advance(300);
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('switches version: unsaved work goes, the target is fetched, the loader shows until it settles', async () => {
    const { result } = load();
    await advance(300);
    act(() => useWorkflowStore.setState({ isDirty: true }));
    discard.mockClear();

    act(() => result.current.performVersionChange(2));
    expect(discard).toHaveBeenCalledOnce();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
    expect(result.current.selection.isSwitchingVersion).toBe(true);
    expect(result.current.selection.selectedVersion).toBe(2);

    await advance(100);
    expect(mocks.getWorkflowWorkflow).toHaveBeenLastCalledWith('wf-1', 2);
    expect(result.current.data.name).toBe('Orders v2');
    await advance(200);
    expect(result.current.selection.isSwitchingVersion).toBe(false);
  });

  it('fetches a version again when it is switched back to', async () => {
    const { result } = load();
    await advance(300);
    act(() => result.current.performVersionChange(2));
    await advance(300);
    const calls = mocks.getWorkflowWorkflow.mock.calls.length;
    act(() => result.current.performVersionChange(3));
    await advance(300);
    expect(mocks.getWorkflowWorkflow.mock.calls.length).toBe(calls + 1);
  });

  it('starts another workflow from clean stores, no staged settings and no selection', async () => {
    const { result, rerender } = load();
    await advance(300);
    act(() => result.current.performVersionChange(2));
    await advance(300);
    const resetExecution = vi.spyOn(
      useExecutionStore.getState(),
      'resetExecution'
    );
    act(() => useWorkflowStore.setState({ isDirty: true }));
    discard.mockClear();

    rerender({ id: 'wf-2' });
    expect(discard).toHaveBeenCalled();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
    await advance(300);
    // The other workflow's current version, not the one picked before.
    expect(mocks.getWorkflowWorkflow).toHaveBeenCalledWith('wf-2', undefined);
    expect(result.current.selection.selectedVersion).toBe(3);
    resetExecution.mockRestore();
  });
});

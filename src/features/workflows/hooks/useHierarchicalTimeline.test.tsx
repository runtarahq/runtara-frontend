import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStepSummaries = vi.hoisted(() => vi.fn());
vi.mock('@/features/workflows/queries', () => ({ getStepSummaries }));

import { useHierarchicalTimeline } from './useHierarchicalTimeline';

const at = (second: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();

const step = (stepId: string, second: number, over = {}) => ({
  stepId,
  stepName: stepId,
  stepType: 'Agent',
  status: 'completed',
  startedAt: at(second),
  durationMs: 1000,
  scopeId: null,
  parentScopeId: null,
  ...over,
});

const page = (steps: unknown[], totalCount = steps.length) => ({
  success: true,
  data: { steps, totalCount },
});

type Filters = { offset?: number; parentScopeId?: string };

/** Sixty root steps, one of them a Split whose scope holds two children. */
function server() {
  const roots = [
    step('split', 0, { stepType: 'Split', scopeId: 'scope-split' }),
    ...Array.from({ length: 59 }, (_, index) =>
      step(`step-${index + 1}`, index + 1)
    ),
  ];
  getStepSummaries.mockImplementation(
    async (_workflowId: string, _instanceId: string, filters: Filters) => {
      if (filters.parentScopeId === 'scope-split') {
        return page([
          step('child-a', 0, { parentScopeId: 'scope-split' }),
          step('child-b', 1, { parentScopeId: 'scope-split' }),
        ]);
      }
      const offset = filters.offset ?? 0;
      return page(roots.slice(offset, offset + 50), roots.length);
    }
  );
}

function timeline(instanceId = 'run-1') {
  // Fresh for five minutes, as the app's client keeps what it fetched.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ run }: { run: string }) =>
      useHierarchicalTimeline('wf-1', run, { refetchInterval: 0 }),
    { wrapper, initialProps: { run: instanceId } }
  );
  return { ...hook, client };
}

const ids = (steps: { stepId: string }[]) => steps.map((s) => s.stepId);

beforeEach(() => {
  getStepSummaries.mockReset();
  server();
});

describe('useHierarchicalTimeline', () => {
  it('loads the first page of top-level steps, laid out from the earliest', async () => {
    const { result } = timeline();
    expect(result.current.isLoadingRoot).toBe(true);

    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));

    expect(getStepSummaries).toHaveBeenCalledWith('wf-1', 'run-1', {
      rootScopesOnly: true,
      sortOrder: 'asc',
      limit: 50,
      offset: 0,
    });
    expect(result.current.totalRootCount).toBe(60);
    expect(result.current.hasMoreRootSteps).toBe(true);
    expect(result.current.isLoadingRoot).toBe(false);
    expect(result.current.minTimestamp).toBe(Date.parse(at(0)));
    // The last of the fifty starts at 49 s and runs one second.
    expect(result.current.totalDuration).toBe(50_000);
    expect(result.current.rootSteps[0].hasChildren).toBe(true);
    expect(result.current.rootSteps[1].hasChildren).toBe(false);
  });

  it('adds the next page to the ones loaded, and keeps them all through a refetch', async () => {
    const { result } = timeline();
    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));

    await act(() => result.current.loadMoreRoot());

    await waitFor(() => expect(result.current.rootSteps).toHaveLength(60));
    expect(getStepSummaries).toHaveBeenLastCalledWith(
      'wf-1',
      'run-1',
      expect.objectContaining({ offset: 50 })
    );
    expect(result.current.hasMoreRootSteps).toBe(false);
    expect(result.current.totalDuration).toBe(60_000);

    // The poll: the store this replaced fell back to the first page here.
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.rootSteps).toHaveLength(60);
  });

  it('loads a step’s children when it is opened, and shows them under it', async () => {
    const { result } = timeline();
    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));
    const split = result.current.visibleSteps[0];

    act(() => result.current.toggleExpand(split));

    expect(result.current.isStepExpanded('split')).toBe(true);
    expect(result.current.isLoadingChildren('split')).toBe(true);
    await waitFor(() =>
      expect(ids(result.current.visibleSteps).slice(0, 4)).toEqual([
        'split',
        'child-a',
        'child-b',
        'step-1',
      ])
    );
    expect(getStepSummaries).toHaveBeenCalledWith('wf-1', 'run-1', {
      parentScopeId: 'scope-split',
      sortOrder: 'asc',
      limit: 100,
    });
    const [parent, child] = result.current.visibleSteps;
    expect(parent).toMatchObject({ isExpanded: true, childrenTotalCount: 2 });
    expect(child.depth).toBe(1);
    expect(result.current.isLoadingChildren('split')).toBe(false);
    expect(ids(result.current.getChildren('scope-split') ?? [])).toEqual([
      'child-a',
      'child-b',
    ]);
  });

  it('closes a step without forgetting its children', async () => {
    const { result } = timeline();
    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));
    act(() => result.current.toggleExpand(result.current.visibleSteps[0]));
    await waitFor(() => expect(result.current.visibleSteps).toHaveLength(52));
    const childFetches = () =>
      getStepSummaries.mock.calls.filter(([, , f]) => f.parentScopeId).length;
    expect(childFetches()).toBe(1);

    act(() => result.current.toggleExpand(result.current.visibleSteps[0]));
    expect(result.current.visibleSteps).toHaveLength(50);

    act(() => result.current.toggleExpand(result.current.visibleSteps[0]));
    // From the cache, at once.
    expect(result.current.visibleSteps).toHaveLength(52);
    expect(childFetches()).toBe(1);
  });

  it('asks for nothing when a step with no children is opened', async () => {
    const { result } = timeline();
    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));
    const calls = getStepSummaries.mock.calls.length;

    act(() => result.current.toggleExpand(result.current.visibleSteps[1]));

    expect(result.current.isStepExpanded('step-1')).toBe(true);
    expect(result.current.isLoadingChildren('step-1')).toBe(false);
    expect(getStepSummaries.mock.calls.length).toBe(calls);
  });

  it('starts another run closed, with that run’s steps', async () => {
    const { result, rerender } = timeline();
    await waitFor(() => expect(result.current.rootSteps).toHaveLength(50));
    act(() => result.current.toggleExpand(result.current.visibleSteps[0]));
    await waitFor(() => expect(result.current.visibleSteps).toHaveLength(52));

    rerender({ run: 'run-2' });

    expect(result.current.isStepExpanded('split')).toBe(false);
    await waitFor(() =>
      expect(getStepSummaries).toHaveBeenCalledWith(
        'wf-1',
        'run-2',
        expect.objectContaining({ rootScopesOnly: true })
      )
    );
    await waitFor(() => expect(result.current.visibleSteps).toHaveLength(50));
  });

  it('keeps only top-level steps when the server sends others, and counts those', async () => {
    getStepSummaries.mockResolvedValue(
      page([step('a', 0), step('nested', 1, { parentScopeId: 'elsewhere' })], 2)
    );
    const { result } = timeline();

    await waitFor(() => expect(result.current.rootSteps).toHaveLength(1));
    expect(result.current.totalRootCount).toBe(1);
    expect(result.current.hasMoreRootSteps).toBe(false);
  });

  it('sums durations by step type over what is shown', async () => {
    getStepSummaries.mockResolvedValue(
      page([
        step('a', 0, { durationMs: 200 }),
        step('b', 1, { durationMs: 300 }),
        step('c', 2, { stepType: 'Log', durationMs: 50 }),
      ])
    );
    const { result } = timeline();

    await waitFor(() => expect(result.current.stats.stepCount).toBe(3));
    expect(result.current.stats.byType).toEqual({ Agent: 500, Log: 50 });
    expect(result.current.stats.rootStepCount).toBe(3);
  });

  it('asks for nothing without a run', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useHierarchicalTimeline('wf-1', undefined),
      { wrapper }
    );

    expect(getStepSummaries).not.toHaveBeenCalled();
    expect(result.current.visibleSteps).toEqual([]);
    expect(result.current.isLoadingRoot).toBe(false);
  });
});

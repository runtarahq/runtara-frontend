import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useQueries,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys } from '@/shared/queries/query-keys';
import { getStepSummaries } from '@/features/workflows/queries';
import {
  HierarchicalStep,
  toHierarchicalStep,
  calculateMinTimestamp,
  calculateMaxTimestamp,
  isOpenEndedStep,
} from '@/features/workflows/types/timeline';

const ROOT_PAGE_SIZE = 50;
const CHILDREN_PAGE_SIZE = 100;

interface UseHierarchicalTimelineOptions {
  /** Polling interval in ms (default: 10000) */
  refetchInterval?: number;
  /** Whether to enable the queries */
  enabled?: boolean;
}

type StepSummariesPage = Awaited<ReturnType<typeof getStepSummaries>>;
type StepSummary = NonNullable<
  NonNullable<StepSummariesPage['data']>['steps']
>[number];

/** stepId → the scope its children run in, for the steps opened. */
type Expanded = ReadonlyMap<string, string | null>;
const NONE_EXPANDED: Expanded = new Map();
const NO_STEPS: StepSummary[] = [];

interface ChildrenOfScope {
  steps: StepSummary[] | undefined;
  totalCount: number | undefined;
  isLoading: boolean;
}

/**
 * The steps of a run as a tree, loaded as it is opened: the top-level steps
 * page after page, and a step's children when it is expanded. All of it is
 * server state and lives in the query cache; which steps are open is the
 * hook's own.
 */
export function useHierarchicalTimeline(
  workflowId: string | undefined,
  instanceId: string | undefined,
  options: UseHierarchicalTimelineOptions = {}
) {
  const { refetchInterval = 10000, enabled = true } = options;
  const ready = !!workflowId && !!instanceId;

  // Which steps are open belongs to the run: another run starts closed.
  const run = `${workflowId ?? ''}/${instanceId ?? ''}`;
  const [expandedIn, setExpandedIn] = useState<{
    run: string;
    steps: Expanded;
  }>({ run, steps: NONE_EXPANDED });
  const expanded = expandedIn.run === run ? expandedIn.steps : NONE_EXPANDED;

  // Top-level steps. Polled, every loaded page of them.
  const roots = useInfiniteQuery({
    queryKey: queryKeys.workflows.timelineRoots(
      workflowId ?? '',
      instanceId ?? null
    ),
    queryFn: ({ pageParam }) =>
      getStepSummaries(workflowId!, instanceId!, {
        rootScopesOnly: true,
        sortOrder: 'asc',
        limit: ROOT_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce(
        (count, page) => count + (page.data?.steps?.length ?? 0),
        0
      );
      const total = lastPage.data?.totalCount ?? 0;
      return lastPage.data?.steps?.length && loaded < total
        ? loaded
        : undefined;
    },
    enabled: ready && enabled,
    refetchInterval,
  });

  const pages = roots.data?.pages;
  const loadedSteps = useMemo(
    () => pages?.flatMap((page) => page.data?.steps ?? []) ?? NO_STEPS,
    [pages]
  );

  // An unfinished (running or parked) step's bar runs up to now, so re-lay
  // the timeline on a clock while one is open, not only when the data changes.
  const [nowTick, setNowTick] = useState(0);
  const hasOpenEndedStep = useMemo(
    () => loadedSteps.some(isOpenEndedStep),
    [loadedSteps]
  );
  useEffect(() => {
    if (!hasOpenEndedStep || !refetchInterval) return;
    const timer = setInterval(
      () => setNowTick((tick) => tick + 1),
      refetchInterval
    );
    return () => clearInterval(timer);
  }, [hasOpenEndedStep, refetchInterval]);

  const { rootSteps, totalRootCount, minTimestamp, totalDuration } =
    useMemo(() => {
      const nowMs = Date.now();
      // Only root steps (those without parentScopeId): a fallback in case the
      // backend doesn't properly filter with rootScopesOnly.
      const steps = loadedSteps.filter((step) => !step.parentScopeId);
      const serverTotal = pages?.[pages.length - 1]?.data?.totalCount ?? 0;
      // If the backend returned non-root steps, count what was kept.
      const totalCount =
        steps.length !== loadedSteps.length ? steps.length : serverTotal;
      if (steps.length === 0) {
        return {
          rootSteps: [] as HierarchicalStep[],
          totalRootCount: totalCount,
          minTimestamp: 0,
          totalDuration: 0,
        };
      }
      const minTs = calculateMinTimestamp(steps);
      const maxTs = calculateMaxTimestamp(steps, nowMs);
      return {
        rootSteps: steps.map((step) =>
          toHierarchicalStep(step, 0, minTs, nowMs)
        ),
        totalRootCount: totalCount,
        minTimestamp: minTs,
        totalDuration: maxTs - minTs,
      };
      // nowTick re-lays the timeline while a step is open-ended.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadedSteps, pages, nowTick]);

  // The children of each open step, by the scope they run in.
  const openScopes = useMemo(
    () => [
      ...new Set(
        [...expanded.values()].filter((scope): scope is string => !!scope)
      ),
    ],
    [expanded]
  );
  const combineChildren = useCallback(
    (results: UseQueryResult<StepSummariesPage>[]) =>
      new Map<string, ChildrenOfScope>(
        results.map((result, index) => [
          openScopes[index],
          {
            steps: result.data?.data?.steps,
            totalCount: result.data?.data?.totalCount,
            isLoading: result.isLoading,
          },
        ])
      ),
    [openScopes]
  );
  const childrenOf = useQueries({
    queries: openScopes.map((scopeId) => ({
      queryKey: queryKeys.workflows.timelineChildren(
        workflowId ?? '',
        instanceId ?? null,
        scopeId
      ),
      // The scope this step creates: its children have it as parentScopeId.
      queryFn: () =>
        getStepSummaries(workflowId!, instanceId!, {
          parentScopeId: scopeId,
          sortOrder: 'asc',
          limit: CHILDREN_PAGE_SIZE,
        }),
      enabled: ready && enabled,
    })),
    combine: combineChildren,
  });

  const childSteps = useMemo(() => {
    const byScope = new Map<string, HierarchicalStep[]>();
    for (const [scopeId, children] of childrenOf) {
      if (children.steps) {
        byScope.set(
          scopeId,
          children.steps.map((step) =>
            toHierarchicalStep(step, 0, minTimestamp)
          )
        );
      }
    }
    return byScope;
  }, [childrenOf, minTimestamp]);

  const toggleExpand = useCallback(
    (step: HierarchicalStep) => {
      setExpandedIn((current) => {
        const steps = new Map(current.run === run ? current.steps : []);
        if (steps.has(step.stepId)) steps.delete(step.stepId);
        else
          steps.set(
            step.stepId,
            step.hasChildren ? step.childrenScopeId : null
          );
        return { run, steps };
      });
    },
    [run]
  );

  const isLoadingChildren = useCallback(
    (stepId: string) => {
      const scopeId = expanded.get(stepId);
      return scopeId ? (childrenOf.get(scopeId)?.isLoading ?? false) : false;
    },
    [expanded, childrenOf]
  );

  // Build the flattened list of visible steps (with hierarchy)
  const visibleSteps = useMemo(() => {
    const result: HierarchicalStep[] = [];

    const addStepsRecursively = (steps: HierarchicalStep[], depth: number) => {
      for (const step of steps) {
        const isExpanded = expanded.has(step.stepId);
        const childrenScopeId = step.childrenScopeId;
        const children = childrenScopeId
          ? childSteps.get(childrenScopeId)
          : undefined;

        result.push({
          ...step,
          isExpanded,
          isLoadingChildren: isLoadingChildren(step.stepId),
          children,
          childrenTotalCount: childrenScopeId
            ? childrenOf.get(childrenScopeId)?.totalCount
            : undefined,
          depth,
        });

        // If expanded and has children, add them recursively
        if (isExpanded && children && children.length > 0) {
          addStepsRecursively(children, depth + 1);
        }
      }
    };

    addStepsRecursively(rootSteps, 0);
    return result;
  }, [rootSteps, expanded, childSteps, childrenOf, isLoadingChildren]);

  // Calculate stats
  const stats = useMemo(() => {
    const byType: Record<string, number> = {};

    for (const step of visibleSteps) {
      const duration = step.durationMs || 0;

      if (!byType[step.stepType]) {
        byType[step.stepType] = 0;
      }
      byType[step.stepType] += duration;
    }

    return {
      total: totalDuration,
      byType,
      stepCount: visibleSteps.length,
      rootStepCount: rootSteps.length,
    };
  }, [visibleSteps, totalDuration, rootSteps.length]);

  const { fetchNextPage } = roots;
  const loadMoreRoot = useCallback(async () => {
    await fetchNextPage();
  }, [fetchNextPage]);

  return {
    // Data
    visibleSteps,
    rootSteps,
    totalRootCount,
    totalDuration,
    minTimestamp,
    stats,

    // Loading states
    isLoadingRoot:
      roots.isFetchingNextPage || (roots.isFetching && rootSteps.length === 0),
    hasMoreRootSteps: roots.hasNextPage,

    // Actions
    loadMoreRoot,
    toggleExpand,
    refetch: roots.refetch,

    // Helpers
    isStepExpanded: (stepId: string) => expanded.has(stepId),
    isLoadingChildren,
    getChildren: (scopeId: string) => childSteps.get(scopeId),
  };
}

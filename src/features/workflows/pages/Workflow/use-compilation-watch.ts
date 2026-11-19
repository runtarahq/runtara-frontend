import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { queryClient } from '@/bootstrap.tsx';
import { useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import { getCompilationProgress } from '@/features/workflows/queries';
import type { CompilationToolbarStatus } from '@/features/workflows/pages/Workflow/WorkflowActionsForm';
import { useBuildWatchTimeout } from './build-watch';

/**
 * Follows the build of one version of a workflow for the toolbar: which
 * version is watched, what its progress reads, which versions the user asked
 * to rebuild, and when to let go of each (a beat after a build ends, or when
 * it cannot be followed).
 *
 * The page says which version to watch (after a save, on Rebuild); everything
 * that happens from there is here.
 */
export function useCompilationWatch(workflowId: string | undefined) {
  // The version we just saved and want to surface compilation progress for.
  // Set in the save mutation's onSuccess; cleared after the user has had a
  // moment to see the terminal state so the toolbar slot frees up again.
  const [watchedCompilationVersion, setWatchedCompilationVersion] = useState<
    number | undefined
  >(undefined);

  // Versions the user explicitly clicked Rebuild on. Set immediately at click
  // time (not derived from polling) so the row's Rebuild button can become
  // "Rebuilding" and disable itself before the first poll arrives — the
  // warm-cache case where compile finishes in <1 s and polling would only
  // ever see the terminal state. Cleared by the same effect that clears
  // `watchedCompilationVersion` after terminal. More than one: starting B
  // while A builds hands A to a background watch instead of dropping it
  // (WF-7).
  const [rebuildingVersions, setRebuildingVersions] = useState<number[]>([]);
  const finishRebuild = useCallback(
    (version: number) =>
      setRebuildingVersions((all) => all.filter((v) => v !== version)),
    []
  );

  // Poll compilation progress for the version the user just saved. Stops on
  // terminal status; the auto-clear effect below frees the toolbar slot a
  // beat after success so the user sees the green check before it vanishes.
  const { data: compilationProgress } = useCustomQuery({
    queryKey: queryKeys.workflows.compilationProgress(
      workflowId ?? '',
      watchedCompilationVersion ?? 0
    ),
    queryFn: () =>
      getCompilationProgress(workflowId!, watchedCompilationVersion!),
    enabled: !!workflowId && watchedCompilationVersion !== undefined,
    // No placeholder: the previous attempt's answer is not this one's, and
    // carrying it over showed a recent failure as a rebuild's result (WF-6).
    placeholderData: undefined,
    refetchInterval: (q) => {
      const last = q.state.data as { status?: string } | undefined;
      if (!last) return 1000;
      if (last.status === 'success' || last.status === 'failed') return false;
      return 1000;
    },
    // Headless browsers (and users who Alt-tab) shouldn't see a stuck
    // "preparing" indicator while the build is long done — keep polling
    // in background until terminal.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  // Compose the toolbar status. `unknown` from the endpoint means no Redis
  // hash and no DB row yet — render nothing rather than a misleading slot.
  //
  // Memoized by content so the post-terminal effect below sees a stable
  // identity once polling stops at success/failed. Without this memo the
  // effect re-runs on every parent re-render (each call returns a fresh
  // object), the timer's cleanup keeps killing it, and the rebuild state
  // never clears — that was the "Rebuild button disappeared and Not
  // compiled badge stuck until refresh" bug.
  const compilationToolbarStatus: CompilationToolbarStatus | undefined =
    useMemo(() => {
      if (
        watchedCompilationVersion === undefined ||
        !compilationProgress ||
        compilationProgress.status === 'unknown'
      ) {
        return undefined;
      }
      return {
        status:
          compilationProgress.status as CompilationToolbarStatus['status'],
        stage: compilationProgress.stage ?? null,
        stageIndex: compilationProgress.stageIndex ?? null,
        totalStages: compilationProgress.totalStages ?? null,
        message: compilationProgress.message ?? null,
        errorMessage: compilationProgress.errorMessage ?? null,
      };
    }, [watchedCompilationVersion, compilationProgress]);

  // Auto-clear the watched version a beat after terminal so the toolbar
  // slot frees up. Also refresh the versions list so the badge picks up
  // the new state (especially important after a force-rebuild, where the
  // version number doesn't change but the badge state does).
  //
  // We `await refetchQueries` inside the timer rather than firing
  // `invalidateQueries` and hoping: without the await, the versions list
  // may still be mid-refetch when `isRebuilding` flips false, so the row
  // briefly reads the API's mid-rebuild snapshot (compiled=false, because
  // the handler deletes the row before the worker re-inserts it).
  // Success: 2.5 s — long enough to register the green check.
  // Failure: 8 s + toast so the user has time to read the error.
  useEffect(() => {
    if (!compilationToolbarStatus) return;
    const status = compilationToolbarStatus.status;
    if (status !== 'success' && status !== 'failed') return;

    const isSuccess = status === 'success';
    // Kick off a refetch immediately so the badge can update as soon as
    // possible; the awaited refetch in the timer is the safety net.
    queryClient.invalidateQueries({
      queryKey: queryKeys.workflows.versions(workflowId ?? ''),
    });
    if (!isSuccess) {
      toast.error('Compilation failed', {
        description:
          compilationToolbarStatus.errorMessage ??
          'See the Versions tab for prior compiled builds.',
      });
    }

    let cancelled = false;
    const id = window.setTimeout(
      async () => {
        try {
          await queryClient.refetchQueries({
            queryKey: queryKeys.workflows.versions(workflowId ?? ''),
          });
        } catch {
          // refetch failure is non-fatal — the user can hit reload
        }
        if (!cancelled) {
          if (watchedCompilationVersion !== undefined)
            finishRebuild(watchedCompilationVersion);
          setWatchedCompilationVersion(undefined);
        }
      },
      isSuccess ? 2500 : 8000
    );

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [
    compilationToolbarStatus,
    workflowId,
    watchedCompilationVersion,
    finishRebuild,
  ]);

  useBuildWatchTimeout(workflowId, watchedCompilationVersion, () => {
    const version = watchedCompilationVersion;
    setWatchedCompilationVersion(undefined);
    setRebuildingVersions((all) => all.filter((v) => v !== version));
  });

  return {
    watchedCompilationVersion,
    setWatchedCompilationVersion,
    rebuildingVersions,
    setRebuildingVersions,
    finishRebuild,
    compilationToolbarStatus,
  };
}

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { queryClient } from '@/bootstrap.tsx';
import { useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import { getCompilationProgress } from '@/features/workflows/queries';

/** How long a build watch waits for a known status before giving up. */
const COMPILATION_WATCH_TIMEOUT_MS = 10_000;

type Progress = { status?: string; errorMessage?: string | null };

const isTerminal = (status: string | undefined) =>
  status === 'success' || status === 'failed';

/**
 * Calls `onGiveUp` once a watch has gone 10 s without a known status: one that
 * stays `unknown`, or a progress endpoint that keeps failing, used to poll every
 * second and keep "Rebuilding" up until a reload (WF-4, WF-5). The clock runs
 * from the last known answer, so a long build that keeps reporting progress is
 * watched to the end.
 */
export function useBuildWatchTimeout(
  workflowId: string | undefined,
  version: number | undefined,
  onGiveUp: () => void
) {
  const giveUp = useRef(onGiveUp);
  giveUp.current = onGiveUp;
  useEffect(() => {
    if (version === undefined || !workflowId) return;
    const key = queryKeys.workflows.compilationProgress(workflowId, version);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const state = queryClient.getQueryState(key);
      const status = (state?.data as Progress | undefined)?.status;
      if (isTerminal(status)) return;
      const known = Boolean(status) && status !== 'unknown';
      const lastAnswer = known
        ? Math.max(startedAt, state!.dataUpdatedAt)
        : startedAt;
      if (Date.now() - lastAnswer < COMPILATION_WATCH_TIMEOUT_MS) return;
      window.clearInterval(id);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.versions(workflowId),
      });
      toast.warning('Could not follow the build', {
        description: 'Check the Versions tab for its result.',
      });
      giveUp.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [workflowId, version]);
}

/**
 * Follows a rebuild the toolbar no longer shows, because a later one took its
 * place. Starting B used to drop A: A's row went back to "Rebuild" and its
 * failure never surfaced (WF-7).
 */
export function BackgroundBuildWatch({
  workflowId,
  version,
  onDone,
}: {
  workflowId: string;
  version: number;
  onDone: (version: number) => void;
}) {
  const { data } = useCustomQuery<Progress>({
    queryKey: queryKeys.workflows.compilationProgress(workflowId, version),
    queryFn: (token: string) =>
      getCompilationProgress(token, workflowId, version),
    placeholderData: undefined,
    refetchInterval: (q) =>
      isTerminal((q.state.data as Progress | undefined)?.status) ? false : 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const done = useRef(onDone);
  done.current = onDone;
  useBuildWatchTimeout(workflowId, version, () => done.current(version));
  const status = data?.status;
  const errorMessage = data?.errorMessage;
  useEffect(() => {
    if (!isTerminal(status)) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workflows.versions(workflowId),
    });
    if (status === 'failed')
      toast.error('Compilation failed', {
        description:
          errorMessage ?? 'See the Versions tab for prior compiled builds.',
      });
    const id = window.setTimeout(
      () => done.current(version),
      status === 'success' ? 2500 : 8000
    );
    return () => window.clearTimeout(id);
  }, [status, errorMessage, workflowId, version]);
  return null;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { queryClient } from '@/shared/queries/query-client';
import { useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import {
  getWorkflowVersions,
  getWorkflowWorkflow,
  type WorkflowVersionInfoDto,
} from '@/features/workflows/queries';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { ExecutionGraphDto } from '@/features/workflows/types/execution-graph';
import { buildSchemaFromFields } from '@/features/workflows/utils/schema';

/**
 * Which version of the workflow the page shows (`selectedVersion`), which one
 * it has asked the server for (`queryVersion`), and whether it is between the
 * two. They differ after a save: the selector moves to the new version while
 * the loaded data is patched in place, without a fetch.
 *
 * State only, so the page can read `isSwitchingVersion` before it loads
 * anything; `useWorkflowLoad` drives it.
 */
export function useVersionSelection() {
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(
    undefined
  );
  const [queryVersion, setQueryVersion] = useState<number | undefined>(
    undefined
  );
  // Switching shows a loader in place, not the full-page one.
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);
  return {
    selectedVersion,
    setSelectedVersion,
    queryVersion,
    setQueryVersion,
    isSwitchingVersion,
    setIsSwitchingVersion,
  };
}

export type VersionSelection = ReturnType<typeof useVersionSelection>;

/**
 * Loads the workflow at the selected version, and its list of versions.
 *
 * It also owns what loading implies: another workflow starts with no staged
 * settings; the fetched graph is drawn in the editor,
 * which starts clean; the current
 * version is selected until the user picks one; and switching version drops
 * what was unsaved and fetches the target afresh.
 */
export function useWorkflowLoad(
  workflowId: string | undefined,
  selection: VersionSelection,
  /** Drops every staged setting. Stable across renders. */
  discardStagedChanges: () => void
) {
  const {
    selectedVersion,
    setSelectedVersion,
    queryVersion,
    setQueryVersion,
    isSwitchingVersion,
    setIsSwitchingVersion,
  } = selection;
  const [versionsWithDebug, setVersionsWithDebug] = useState<
    WorkflowVersionInfoDto[]
  >([]);

  // Fetch available versions
  const { data: versionsResponse } = useCustomQuery({
    queryKey: queryKeys.workflows.versions(workflowId ?? ''),
    queryFn: () => getWorkflowVersions(workflowId!),
    enabled: !!workflowId,
    placeholderData: { data: [], message: '', success: true } as any,
  });

  // Extract versions from wrapped response
  const versions = useMemo(
    () => (versionsResponse as any)?.data || [],
    [versionsResponse]
  );

  // Use queryVersion for the actual query to control when it changes
  const { data: response, isFetching } = useCustomQuery({
    queryKey: queryKeys.workflows.workflow(workflowId ?? '', queryVersion),
    queryFn: () => getWorkflowWorkflow(workflowId!, queryVersion),
    enabled: !!workflowId,
    placeholderData: { data: {}, message: '', success: true } as any,
  });

  // Extract workflow data from wrapped response
  const data = useMemo(() => (response as any)?.data || {}, [response]);
  const hasInputSchema = useMemo(
    () => ((data as any)?.inputSchemaFields ?? []).length > 0,
    [data]
  );
  const workflowInputSchema = useMemo(() => {
    const fields = (data as any)?.inputSchemaFields ?? [];
    return fields.length > 0 ? buildSchemaFromFields(fields) : {};
  }, [data]);

  // Another workflow: no staged settings, no selected version, fresh data.
  // The editor's stores need nothing: the page gives each workflow its own
  // (EditorStoresProvider).
  useEffect(() => {
    discardStagedChanges();

    setSelectedVersion(undefined);
    setQueryVersion(undefined);

    // Batch invalidate queries to ensure fresh data is fetched for the new workflow
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.workflow(workflowId ?? ''),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.versions(workflowId ?? ''),
      }),
    ]);
  }, [workflowId, discardStagedChanges, setSelectedVersion, setQueryVersion]);

  // Draw what was fetched. This is the one place a fetched graph enters the
  // editor: the query cache holds the server's graph, and the store turns it
  // into the canvas and starts it clean. Keyed by the graph itself, which the
  // query client keeps the same object while its content is the same, so a
  // refetch that brings nothing new leaves the canvas, and edits to it, alone.
  const executionGraph = (data as { executionGraph?: ExecutionGraphDto })
    .executionGraph;
  useEffect(() => {
    if (executionGraph) {
      useWorkflowStore.getState().setExecutionGraph(executionGraph);
    }
  }, [executionGraph]);

  // Set the current version as the default selected version when data is loaded
  useEffect(() => {
    if (data.currentVersionNumber && selectedVersion === undefined) {
      setSelectedVersion(data.currentVersionNumber);
      setQueryVersion(data.currentVersionNumber);
    }
  }, [
    data.currentVersionNumber,
    selectedVersion,
    setSelectedVersion,
    setQueryVersion,
  ]);

  // Set versions with debug mode from API response
  useEffect(() => {
    if (!versions || versions.length === 0) {
      setVersionsWithDebug([]);
      return;
    }

    // API now provides trackEvents directly in WorkflowVersionInfoDto
    setVersionsWithDebug(versions);
  }, [versions]);

  // The switch is over when the target version has arrived.
  useEffect(() => {
    if (!isFetching && isSwitchingVersion) setIsSwitchingVersion(false);
  }, [isFetching, isSwitchingVersion, setIsSwitchingVersion]);

  // Internal version change handler (bypasses unsaved changes check)
  const performVersionChange = useCallback(
    (version: number | undefined) => {
      // Clear dirty flag when switching versions
      useWorkflowStore.getState().clearDirtyFlag();
      // Clear staged workflow changes when switching versions
      discardStagedChanges();

      // Mark that we're switching versions to show inline loading
      setIsSwitchingVersion(true);

      // Remove cached data for the target version to force a fresh fetch
      // This ensures we always get the correct workflow data for each version
      queryClient.removeQueries({
        queryKey: queryKeys.workflows.workflow(workflowId ?? '', version),
        exact: true,
      });

      setSelectedVersion(version);
      setQueryVersion(version); // This will trigger a new query
    },
    [
      workflowId,
      discardStagedChanges,
      setIsSwitchingVersion,
      setSelectedVersion,
      setQueryVersion,
    ]
  );

  return {
    data,
    isFetching,
    versionsWithDebug,
    setVersionsWithDebug,
    hasInputSchema,
    workflowInputSchema,
    performVersionChange,
  };
}

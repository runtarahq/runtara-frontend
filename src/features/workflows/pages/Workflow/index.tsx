import {
  useWorkflowSettings,
  type WorkflowChanges,
} from './useWorkflowSettings';
import { useWorkflowExecution } from './useWorkflowExecution';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useCustomMutation } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import { WorkflowEditor } from '@/features/workflows/components/WorkflowEditor';
import { WorkflowActionsForm } from '@/features/workflows/pages/Workflow/WorkflowActionsForm';
import { Loader } from '@/shared/components/loader.tsx';
import { composeExecutionGraph } from '@/features/workflows/components/WorkflowEditor/CustomNodes/utils.tsx';
import '@xyflow/react/dist/base.css';
import { queryClient } from '@/shared/queries/query-client';
import { slugify } from '@/shared/utils/string-utils';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore.ts';
import { DebugStepInspector } from '@/features/workflows/components/DebugStepInspector';

import { WorkflowExecuteDialog } from '@/features/workflows/components/WorkflowExecuteDialog';
import {
  setCurrentVersion,
  updateWorkflow,
  toggleTrackEvents,
} from '@/features/workflows/queries';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { useExecutionStore } from '@/features/workflows/stores/executionStore';
import { isWaitingSuspension } from '@/features/workflows/utils/suspension';

import { UnsavedChangesDialog } from '@/shared/components/unsaved-changes-dialog';
import { dropSavedEntries } from './drop-saved-entries';
import { parseWorkflowImport } from './import-workflow';
import { runFailureMessage } from './run-failure';
import { useCompilationWatch } from './use-compilation-watch';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { useVersionSelection, useWorkflowLoad } from './use-workflow-load';
import { prepareWorkflowSave } from './save-workflow';
import { graphOptions, mergeWorkflowSettings } from './workflow-settings';
import { useOneAtATime } from './use-one-at-a-time';
import { BackgroundBuildWatch } from './build-watch';
import { rebuildWorkflowVersion } from '@/features/workflows/queries';
import { ValidationPanel } from '@/features/workflows/components/ValidationPanel';
import { useValidationStore } from '@/features/workflows/stores/validationStore';
import { convertServerErrors } from '@/features/workflows/utils/validation-helpers';

import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
} from '@/features/workflows/config/workflow';
import { offsetNextToStep } from '@/features/workflows/components/WorkflowEditor/CustomNodes/note-placement';
import { screenToCanvas } from '@/features/workflows/components/WorkflowEditor/canvas-bridge';
import {
  readCanvasDetail,
  writeCanvasDetail,
} from '@/features/workflows/components/WorkflowEditor/editor-preferences';
import type { CanvasDetailLevel } from '@/features/workflows/components/WorkflowEditor/CustomNodes/node-size';
import { isActiveStatus } from '@/shared/utils/status-display';

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function Workflow() {
  const { workflowId } = useParams();
  // Which version is shown and which is loaded (./use-workflow-load.ts).
  const versionSelection = useVersionSelection();
  const {
    selectedVersion,
    setSelectedVersion,
    queryVersion,
    setQueryVersion,
    isSwitchingVersion,
  } = versionSelection;

  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // What the toolbar and the version rows show of a build (see
  // ./use-compilation-watch.ts).
  const {
    watchedCompilationVersion,
    setWatchedCompilationVersion,
    rebuildingVersions,
    setRebuildingVersions,
    finishRebuild,
    compilationToolbarStatus,
  } = useCompilationWatch(workflowId);

  // Staged workflow changes (name, description, variables, schemas, timeout) - preserved until global save
  const [stagedWorkflowChanges, setStagedWorkflowChanges] =
    useState<WorkflowChanges>({});
  const discardStagedChanges = useCallback(
    () => setStagedWorkflowChanges({}),
    []
  );

  // A new page starts with no steps highlighted as staged.
  useEffect(() => {
    useWorkflowStore.getState().setStagedNodeIds(new Set());
  }, []);

  // Whether there is anything unsaved, and asking before it is thrown away
  // (./use-unsaved-changes-guard.ts).
  const {
    hasUnsavedChanges,
    hasStructuralUnsavedChanges,
    confirmIfUnsavedChanges,
    isUnsavedChangesDialogOpen,
    handleConfirmUnsavedChanges,
    handleCancelUnsavedChanges,
  } = useUnsavedChangesGuard({
    isSwitchingVersion,
    stagedWorkflowChanges,
    discardStagedChanges,
  });

  // The workflow at the loaded version, its versions, and switching between
  // them (./use-workflow-load.ts).
  const {
    data,
    isFetching,
    versionsWithDebug,
    setVersionsWithDebug,
    hasInputSchema,
    workflowInputSchema,
    performVersionChange,
  } = useWorkflowLoad(workflowId, versionSelection, discardStagedChanges);

  // Sync queryVersion with selectedVersion only when user explicitly changes version
  // Not when we programmatically update it after save
  const handleVersionChange = useCallback(
    (version: number | undefined) => {
      confirmIfUnsavedChanges(() => performVersionChange(version));
    },
    [confirmIfUnsavedChanges, performVersionChange]
  );

  // Set page title with workflow name
  usePageTitle(data.name ? `Workflows - ${data.name}` : 'Edit Workflow');

  // The staged workflow changes the in-flight save sent, for the cache update.
  // Not the live staged changes: those may hold edits made since (WF-2).
  const savingWorkflowChangesRef = useRef<WorkflowChanges>({});

  // The store's dirty revision the in-flight save was built from. Edits made
  // while it is in flight move the revision on and stay unsaved (WF-1).
  const savingRevisionRef = useRef<number | undefined>(undefined);

  const updateMutation = useCustomMutation({
    mutationFn: updateWorkflow,
    suppressValidationToasts: true, // Use validation panel instead of toasts
    onSuccess: async (response: any) => {
      // Response structure: { message, workflowId, success, timestamp, version: "28" }
      const newVersionNumber = response?.version
        ? parseInt(response.version, 10)
        : undefined;

      // Clear the dirty flag for what this save carried; an edit made since
      // keeps it set.
      useWorkflowStore.getState().clearDirtyFlag(savingRevisionRef.current);

      // Capture staged changes before they get cleared
      const savedStagedChanges = savingWorkflowChangesRef.current;

      if (newVersionNumber) {
        // Surface compilation progress for the just-saved version.
        setWatchedCompilationVersion(newVersionNumber);
        // Update selectedVersion to show the new version in the selectbox
        setSelectedVersion(newVersionNumber);

        // Get the current cached data
        const currentCachedData = queryClient.getQueryData(
          queryKeys.workflows.workflow(workflowId ?? '', queryVersion)
        ) as any;

        // Update the cached data for the new version
        // Note: Do NOT update currentVersionNumber here - saving a new version does not
        // make it the active version. currentVersionNumber should only change when
        // explicitly activating a version via setCurrentVersion API.
        if (currentCachedData) {
          const updatedData = {
            ...currentCachedData,
            data: {
              ...currentCachedData.data,
              // Update name and description if they were changed
              ...(savedStagedChanges.name !== undefined && {
                name: savedStagedChanges.name,
              }),
              ...(savedStagedChanges.description !== undefined && {
                description: savedStagedChanges.description,
              }),
              ...(savedStagedChanges.variables !== undefined && {
                variables: savedStagedChanges.variables,
              }),
              ...(savedStagedChanges.inputSchemaFields !== undefined && {
                inputSchemaFields: savedStagedChanges.inputSchemaFields,
              }),
              ...(savedStagedChanges.outputSchemaFields !== undefined && {
                outputSchemaFields: savedStagedChanges.outputSchemaFields,
              }),
              ...(savedStagedChanges.stateSchemaFields !== undefined && {
                stateSchemaFields: savedStagedChanges.stateSchemaFields,
              }),
              ...(savedStagedChanges.executionTimeoutSeconds !== undefined && {
                executionTimeoutSeconds:
                  savedStagedChanges.executionTimeoutSeconds,
              }),
              ...(savedStagedChanges.rateLimitBudgetMs !== undefined && {
                rateLimitBudgetMs: savedStagedChanges.rateLimitBudgetMs,
              }),
              ...(hasOwn(savedStagedChanges, 'durable') && {
                durable: savedStagedChanges.durable,
              }),
              ...(savedStagedChanges.entryPoint !== undefined && {
                entryPoint: savedStagedChanges.entryPoint,
              }),
              ...(hasOwn(savedStagedChanges, 'memoryMb') && {
                memoryMb: savedStagedChanges.memoryMb,
              }),
              ...(savedStagedChanges.trackEvents !== undefined && {
                trackEvents: savedStagedChanges.trackEvents,
              }),
              // Keep the original currentVersionNumber (the active version)
            },
          };

          // Update the current query's cached data
          queryClient.setQueryData(
            queryKeys.workflows.workflow(workflowId ?? '', queryVersion),
            updatedData
          );

          // Also set the cache for the new version number
          queryClient.setQueryData(
            queryKeys.workflows.workflow(workflowId ?? '', newVersionNumber),
            updatedData
          );
        }
      }

      // Fetch new versions in background to update the version list
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.versions(workflowId ?? ''),
      });

      // Open the versions tab to show the newly created version
      useValidationStore.getState().setActiveTab('versions');
    },
  });

  const {
    scheduleMutation,
    executingInstanceId,
    executionInstanceData,
    isSuspended,
    resumeMutation,
    stopMutation,
    handleResume,
    handleStop,
    handleResetExecution,
  } = useWorkflowExecution(workflowId);

  const setCurrentVersionMutation = useCustomMutation({
    mutationFn: setCurrentVersion,
    onSuccess: async () => {
      // Remove all cached workflow versions for this workflow to ensure fresh data on return
      // Using removeQueries with exact: false matches all cache entries starting with this key prefix
      queryClient.removeQueries({
        queryKey: queryKeys.workflows.workflow(workflowId ?? ''),
        exact: false,
      });

      // Update versions metadata
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.versions(workflowId ?? ''),
      });

      // Invalidate the main workflows list to update the displayed version number
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.all,
      });
    },
  });

  const toggleTrackEventsMutation = useCustomMutation({
    mutationFn: toggleTrackEvents,
    onSuccess: async (
      response: any,
      variables: { workflowId: string; version: number; trackEvents: boolean }
    ) => {
      const newTrackEvents = response?.data?.trackEvents;
      const toggledVersion = variables.version;

      toast.info(
        `Event tracking ${newTrackEvents ? 'enabled' : 'disabled'} for version ${toggledVersion}`
      );

      // Update the current query's cached data if we toggled the selected version
      if (queryVersion === toggledVersion) {
        queryClient.setQueryData(
          queryKeys.workflows.workflow(workflowId ?? '', queryVersion),
          (oldData: any) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              data: {
                ...oldData.data,
                trackEvents: newTrackEvents,
              },
            };
          }
        );
      }

      // Update the versions list to reflect the track events change
      setVersionsWithDebug((prevVersions) =>
        prevVersions.map((v) =>
          v.versionNumber === toggledVersion
            ? { ...v, trackEvents: newTrackEvents }
            : v
        )
      );
    },
  });

  // Workflow-level changes from the settings panel and the canvas (e.g. a new
  // entry point), kept until the global save like node changes.
  const handleWorkflowChange = useCallback(
    (changes: Partial<typeof stagedWorkflowChanges>) => {
      setStagedWorkflowChanges((prev) => ({
        ...prev,
        ...changes,
      }));
    },
    []
  );

  // One save at a time (WF-3).
  const handleSubmit = useOneAtATime((values: Record<string, any>) =>
    submitWorkflow(values)
  );

  const submitWorkflow = async ({ name }: Record<string, any>) => {
    // What this save sends; see dropSavedEntries.
    const sentWorkflowChanges = stagedWorkflowChanges;
    const finalState = useWorkflowStore.getState();
    const savedRevision = finalState.dirtyRevision;

    // Composed and checked by the browser's validator (./save-workflow.ts).
    const prepared = await prepareWorkflowSave({
      name,
      data,
      staged: stagedWorkflowChanges,
      isDirty: finalState.isDirty,
      nodes: finalState.nodes,
      edges: finalState.edges,
    });
    if (prepared.outcome === 'unchanged') {
      toast.info('No changes to save');
      return;
    }
    if (prepared.outcome === 'invalid') {
      useValidationStore.getState().setMessages(prepared.messages);
      const firstErrorStepId = prepared.focusFirstError
        ? useValidationStore.getState().getFirstErrorStepId()
        : null;
      if (firstErrorStepId) {
        useWorkflowStore.getState().setSelectedNodeId(firstErrorStepId);
        useWorkflowStore.getState().setPendingCenterNodeId(firstErrorStepId);
      }
      return;
    }
    const preSaveWarnings = prepared.warnings;
    // Warnings alone are shown, and the save goes on.
    if (preSaveWarnings.length > 0) {
      useValidationStore.getState().setMessages(preSaveWarnings);
    }

    // Single update call for workflow, metadata, and schemas
    try {
      savingRevisionRef.current = savedRevision;
      savingWorkflowChangesRef.current = sentWorkflowChanges;
      await new Promise((resolve, reject) => {
        updateMutation.mutate(
          { id: workflowId!, ...prepared.request },
          {
            onSuccess: resolve,
            onError: reject,
          }
        );
      });
      // Clear the staged changes this save sent. Ones edited while it was in
      // flight were not sent, so they stay staged and unsaved.
      setStagedWorkflowChanges((current) =>
        dropSavedEntries(current, sentWorkflowChanges)
      );
      // Clear any validation errors from previous failed saves
      useValidationStore.getState().clearMessages();
    } catch (error: any) {
      // Extract validation errors from the API response
      const validationErrors = error?.response?.data?.validationErrors;
      if (validationErrors && validationErrors.length > 0) {
        // Convert server errors to ValidationMessage format and show in panel
        const serverErrors = convertServerErrors(
          validationErrors,
          useWorkflowStore.getState().nodes
        );
        // Combine server errors with client warnings so both are visible (SYN-234)
        useValidationStore
          .getState()
          .setMessages([...serverErrors, ...preSaveWarnings]);

        // Focus the view on the first step with an error
        const firstErrorStepId = useValidationStore
          .getState()
          .getFirstErrorStepId();
        if (firstErrorStepId) {
          // Select and center on the first error node
          useWorkflowStore.getState().setSelectedNodeId(firstErrorStepId);
          useWorkflowStore.getState().setPendingCenterNodeId(firstErrorStepId);
        }
      }
      // Error toast is already handled by mutation's onError callbacks (for non-validation errors)
      console.error('Failed to save changes:', error);
    }
  };

  const handleSchedule = () => {
    if (!workflowId) {
      toast.error('Workflow ID is missing');
      return;
    }
    if (!hasInputSchema) {
      handleExecuteWorkflow({});
      return;
    }
    setExecuteError(null);
    setExecuteDialogOpen(true);
  };

  // Starts a run, plain or under the debugger, from its dialog or (for a
  // workflow that takes no input) straight from the toolbar. A refusal is
  // shown in the dialog when it is open, else as a toast.
  const startRun = async (
    inputs: Record<string, any>,
    mode: 'run' | 'debug'
  ) => {
    if (!workflowId) {
      toast.error('Workflow ID is missing');
      return;
    }
    const debug = mode === 'debug';
    const dialogOpen = debug ? debugExecuteDialogOpen : executeDialogOpen;
    const setDialogOpen = debug
      ? setDebugExecuteDialogOpen
      : setExecuteDialogOpen;
    setExecuteError(null);

    try {
      await scheduleMutation.mutateAsync({
        workflowId,
        // A debug run always tracks its events.
        trackEvents: debug ? true : data.trackEvents || false,
        inputs,
        version: selectedVersion,
        ...(debug ? { debug: true } : {}),
      });
      setDialogOpen(false);
    } catch (error: unknown) {
      const message = runFailureMessage(error);
      if (message === null) return;
      if (dialogOpen) {
        setExecuteError(message);
      } else {
        toast.error(message);
      }
    }
  };

  const handleExecuteWorkflow = (inputs: Record<string, any>) =>
    startRun(inputs, 'run');

  // ── Server-side Debug Execution (breakpoints) ──────────────────────────
  const [debugExecuteDialogOpen, setDebugExecuteDialogOpen] = useState(false);

  const handleDebugExecuteServer = () => {
    if (!workflowId) {
      toast.error('Workflow ID is missing');
      return;
    }
    if (!hasInputSchema) {
      handleDebugExecuteServerSubmit({});
      return;
    }
    setExecuteError(null);
    setDebugExecuteDialogOpen(true);
  };

  const handleDebugExecuteServerSubmit = (inputs: Record<string, any>) =>
    startRun(inputs, 'debug');

  /**
   * Navigate to a specific step in the workflow editor.
   * Called when user clicks on a validation message to jump to the affected step.
   */
  const handleNavigateToStep = useCallback((stepId: string) => {
    const { nodes, setSelectedNodeId, setPendingCenterNodeId } =
      useWorkflowStore.getState();
    const targetNode = nodes.find((n) => n.id === stepId);

    if (targetNode) {
      // Select the node to open sidebar
      setSelectedNodeId(stepId);
      // Center viewport on the node
      setPendingCenterNodeId(stepId);
    }
  }, []);

  const handleVersionActivate = (version: number) => {
    if (!workflowId) {
      toast.error('Workflow ID is missing');
      return;
    }
    setCurrentVersionMutation.mutate(
      {
        workflowId,
        versionNumber: version,
      },
      {
        onSuccess: () => {
          // Switch to the newly activated version in the editor
          setSelectedVersion(version);
          setQueryVersion(version);
        },
      }
    );
  };

  // Force-rebuild a compiled version. Fire-and-forget — the backend's
  // /compile?forceRecompile=true handler runs `invalidate_compilation`
  // (drops checksum + image_id) and re-enqueues with force_recompile=true,
  // so both cache layers miss. Progress is reflected via the existing
  // toolbar poll keyed on `watchedCompilationVersion`.
  const rebuildMutation = useCustomMutation<
    void,
    { workflowId: string; version: number }
  >({
    mutationFn: ({ workflowId: wid, version }) =>
      rebuildWorkflowVersion(wid, version),
  });

  const handleVersionRebuild = useCallback(
    (version: number) => {
      if (!workflowId) {
        toast.error('Workflow ID is missing');
        return;
      }
      // The last attempt's progress is not this one's: drop it, so a recent
      // failure does not show as the rebuild's result straight away (WF-6).
      queryClient.removeQueries({
        queryKey: queryKeys.workflows.compilationProgress(workflowId, version),
      });
      setRebuildingVersions((all) =>
        all.includes(version) ? all : [...all, version]
      );
      setWatchedCompilationVersion(version);
      rebuildMutation.mutate({ workflowId, version });
    },
    [
      workflowId,
      rebuildMutation,
      setRebuildingVersions,
      setWatchedCompilationVersion,
    ]
  );

  const handleExportJSON = () => {
    // Get the current state from Zustand store
    const { nodes, edges } = useWorkflowStore.getState();

    // The saved settings with the staged ones over them, as a save has them.
    const settings = mergeWorkflowSettings(data, stagedWorkflowChanges);
    const exportName = settings.name;
    const exportDescription = settings.description;
    const exportDurable = settings.durable;
    const exportMemoryMb = settings.memoryMb;
    const exportTrackEvents = settings.trackEvents;

    const executionGraph = composeExecutionGraph(nodes, edges, {
      name: exportName,
      ...graphOptions(settings),
    });

    if (executionGraph) {
      // Wrap with name and description for the new format
      const exportData = {
        name: exportName,
        description: exportDescription,
        ...(exportMemoryMb !== undefined ? { memoryMb: exportMemoryMb } : {}),
        ...(exportTrackEvents !== undefined
          ? { trackEvents: exportTrackEvents }
          : {}),
        ...(exportDurable !== undefined && exportDurable !== null
          ? { durable: exportDurable }
          : {}),
        executionGraph,
      };

      // Create a JSON blob and download it
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      // Create a temporary link and trigger download
      const a = document.createElement('a');
      a.href = url;

      // Use slugified workflow name and append version to the filename
      // Use selectedVersion (the version being viewed) instead of currentVersionNumber (the active version)
      const slugifiedName = exportName ? slugify(exportName) : 'export';
      const versionToExport = selectedVersion ?? data.currentVersionNumber;
      const versionSuffix = versionToExport ? `-v${versionToExport}` : '';
      a.download = `${slugifiedName}${versionSuffix}.json`;

      document.body.appendChild(a);
      a.click();

      // Clean up
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.info('Execution graph exported successfully');
    } else {
      toast.error('No execution graph to export');
    }
  };

  // Internal import handler (bypasses unsaved changes check)
  const performImportJSON = useCallback((jsonString: string) => {
    // What the file holds (./import-workflow.ts); applying it is the page's.
    const imported = parseWorkflowImport(jsonString);
    if (!imported.ok) {
      toast.error(
        imported.reason === 'not-a-graph'
          ? 'Invalid execution graph format'
          : 'Failed to import execution graph'
      );
      return;
    }
    try {
      setStagedWorkflowChanges(imported.settings);
      useWorkflowStore.getState().setExecutionGraph(imported.executionGraph);
      toast.info('Execution graph imported successfully');
    } catch (error) {
      console.error('Error importing execution graph:', error);
      toast.error('Failed to import execution graph');
    }
  }, []);

  const handleImportJSON = useCallback(
    (jsonString: string) => {
      confirmIfUnsavedChanges(() => performImportJSON(jsonString));
    },
    [confirmIfUnsavedChanges, performImportJSON]
  );

  // Step card detail level. Lives here, not in the editor, so the header can
  // switch it; remembered per browser.
  const [canvasDetail, setCanvasDetailState] =
    useState<CanvasDetailLevel>(readCanvasDetail);
  const setCanvasDetail = useCallback((detail: CanvasDetailLevel) => {
    setCanvasDetailState(detail);
    writeCanvasDetail(detail);
  }, []);

  const handleAddNote = () => {
    const store = useWorkflowStore.getState();
    const noteSize = NODE_TYPE_SIZES[NODE_TYPES.NoteNode] ?? {
      width: 240,
      height: 120,
    };

    // With a step selected, the note is about that step: attach it just
    // above it, so it follows the step through every re-layout.
    const selectedStep = store.selectedNodeId
      ? store.nodes.find(
          (n) => n.id === store.selectedNodeId && n.type !== NODE_TYPES.NoteNode
        )
      : undefined;
    if (selectedStep) {
      store.addNote(offsetNextToStep(noteSize.height), '', {
        anchorStepId: selectedStep.id,
        autoEdit: true,
      });
      return;
    }

    // Otherwise drop it in the middle of the canvas the user can see: the
    // editor's own box, minus the docked step panel when it covers the right
    // side. The window centre ignored the sidebar and the panel.
    const root = document.querySelector('[data-workflow-editor-root]');
    const box = root?.getBoundingClientRect();
    let left = box?.left ?? 0;
    let right = box?.right ?? window.innerWidth;
    const top = box?.top ?? 0;
    const bottom = box?.bottom ?? window.innerHeight;
    const panel = document
      .querySelector('[data-testid="node-config-dialog"]')
      ?.getBoundingClientRect();
    if (panel && panel.left > left && panel.left < right) {
      right = panel.left;
    }
    if (right - left < noteSize.width) left = right - noteSize.width;
    const center = screenToCanvas({
      x: (left + right) / 2,
      y: (top + bottom) / 2,
    }) ?? { x: 0, y: 0 };
    store.addNote(
      {
        x: center.x - noteSize.width / 2,
        y: center.y - noteSize.height / 2,
      },
      '',
      { autoEdit: true }
    );
  };

  const isLoading =
    updateMutation.isPending ||
    scheduleMutation.isPending ||
    setCurrentVersionMutation.isPending ||
    toggleTrackEventsMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending;

  // Check if any step has a breakpoint set
  const hasBreakpoints = useWorkflowStore((state) =>
    state.nodes.some((n) => (n.data as any)?.breakpoint)
  );
  const workflowForSettings = useWorkflowSettings(
    workflowId,
    data,
    stagedWorkflowChanges
  );

  if (!workflowId) {
    return <div className="p-6 text-center">Workflow ID is missing</div>;
  }

  // Only show full-page loader on initial load, not when switching versions
  if (isFetching && !isSwitchingVersion) {
    return <Loader />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {workflowId &&
        rebuildingVersions
          .filter((version) => version !== watchedCompilationVersion)
          .map((version) => (
            <BackgroundBuildWatch
              key={version}
              workflowId={workflowId}
              version={version}
              onDone={finishRebuild}
            />
          ))}
      <WorkflowActionsForm
        isLoading={isLoading}
        workflowName={stagedWorkflowChanges.name ?? data.name ?? ''}
        onSchedule={handleSchedule}
        onSubmit={handleSubmit}
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        canvasDetail={canvasDetail}
        onCanvasDetailChange={setCanvasDetail}
        onAddNote={handleAddNote}
        isExecuting={!!executingInstanceId}
        isExecutionActive={isActiveStatus(executionInstanceData?.status)}
        isDirty={hasStructuralUnsavedChanges}
        hasUnsavedChanges={hasUnsavedChanges}
        onStop={handleStop}
        onClearExecution={handleResetExecution}
        onViewExecutionDetails={() => {
          // Switch to history tab (this also expands the panel)
          useValidationStore.getState().setActiveTab('history');
          // Select the running instance in history
          useExecutionStore
            .getState()
            .setSelectedInvocationId(executingInstanceId);
        }}
        executionStats={
          executionInstanceData
            ? {
                status: executionInstanceData.status,
                queueDuration:
                  executionInstanceData.queueDurationSeconds ?? undefined,
                executionDuration:
                  executionInstanceData.executionDurationSeconds ?? undefined,
                maxMemory: executionInstanceData.maxMemoryMb ?? undefined,
                terminationType:
                  executionInstanceData.terminationType ?? undefined,
              }
            : undefined
        }
        onDebugExecute={handleDebugExecuteServer}
        isSuspended={isSuspended}
        waitingReason={
          isWaitingSuspension(executionInstanceData)
            ? executionInstanceData?.suspensionReason
            : null
        }
        onResume={handleResume}
        isResuming={resumeMutation.isPending}
        hasBreakpoints={hasBreakpoints}
        compilationStatus={compilationToolbarStatus}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">
          {isSwitchingVersion && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
              <Loader />
            </div>
          )}
          <WorkflowEditor
            nodes={data.nodes}
            edges={data.edges}
            readOnly={!!executingInstanceId}
            debugInspectMode={isSuspended}
            workflow={workflowForSettings}
            onWorkflowChange={handleWorkflowChange}
            canvasDetail={canvasDetail}
          />
          {/* Debug step inspector — floating panel when suspended */}
          {isSuspended && <DebugStepInspector />}
        </div>
      </div>

      <ValidationPanel
        onNavigateToStep={handleNavigateToStep}
        workflowId={workflowId}
        workflow={workflowForSettings}
        onWorkflowChange={handleWorkflowChange}
        readOnly={!!executingInstanceId}
        versions={versionsWithDebug}
        selectedVersion={selectedVersion}
        onVersionChange={handleVersionChange}
        onVersionActivate={handleVersionActivate}
        onVersionRebuild={handleVersionRebuild}
        rebuildingVersions={rebuildingVersions}
        isVersionLoading={isLoading}
      />

      <WorkflowExecuteDialog
        open={executeDialogOpen}
        onOpenChange={(open) => {
          setExecuteError(null);
          setExecuteDialogOpen(open);
        }}
        workflowName={data.name}
        inputSchema={workflowInputSchema}
        onExecute={handleExecuteWorkflow}
        isSubmitting={scheduleMutation.isPending}
        serverError={executeError}
      />

      {/* Debug execute dialog (server-side breakpoints) — reuses WorkflowExecuteDialog */}
      <WorkflowExecuteDialog
        open={debugExecuteDialogOpen}
        onOpenChange={(open) => {
          setExecuteError(null);
          setDebugExecuteDialogOpen(open);
        }}
        workflowName={`${data.name} (Debug)`}
        inputSchema={workflowInputSchema}
        onExecute={handleDebugExecuteServerSubmit}
        isSubmitting={scheduleMutation.isPending}
        serverError={executeError}
      />

      <UnsavedChangesDialog
        open={isUnsavedChangesDialogOpen}
        onConfirm={handleConfirmUnsavedChanges}
        onCancel={handleCancelUnsavedChanges}
      />
    </div>
  );
}

import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useCustomMutation, useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import { queryClient } from '@/bootstrap';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useExecutionStore } from '@/features/workflows/stores/executionStore';
import {
  scheduleWorkflow,
  getWorkflowInstance,
  getStepEvents,
  queuedInstancePlaceholder,
  holdForQueuedRow,
  resumeInstance,
  stopInstance,
  type QueuedRun,
} from '@/features/workflows/queries';
import {
  isAtBreakpoint,
  isWaitingSuspension,
} from '@/features/workflows/utils/suspension';
import { createStepNodeResolver } from '@/features/workflows/utils/step-node-resolver';
import type { ExecutionStatus } from '@/generated/RuntaraRuntimeApi';
import { breakpointKey } from './breakpoint-key';

/** Owns run scheduling, polling, breakpoint state, and canvas execution status. */
export function useWorkflowExecution(workflowId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    startExecution,
    executingInstanceId,
    debugMode: executionDebugMode,
    isSuspended,
    updateNodeStatus,
    updateInstanceStatus,
    setSuspended,
    setStepDebugData,
    resetExecution,
  } = useExecutionStore();

  // The run this page started, and when — read by the instance query below.
  const queuedRunRef = useRef<QueuedRun | null>(null);

  const scheduleMutation = useCustomMutation({
    mutationFn: (
      token: string,
      {
        workflowId,
        inputs,
        version,
        debug,
      }: {
        workflowId: string;
        trackEvents: boolean;
        inputs?: Record<string, any>;
        version?: number;
        debug?: boolean;
      }
    ) => scheduleWorkflow(token, workflowId, inputs, version, debug),
    onSuccess: (
      response: any,
      variables: {
        workflowId: string;
        trackEvents: boolean;
        inputs?: Record<string, any>;
        version?: number;
        debug?: boolean;
      }
    ) => {
      // Response is wrapped: { data: ExecuteWorkflowResponse, message, success }
      // ExecuteWorkflowResponse: { instanceId, status }
      const instanceId = response?.data?.instanceId;

      if (instanceId && variables.workflowId) {
        // Show the queued status the response already carries, and note when the
        // run was queued so the first read of its row can wait for the runtime
        // to write one.
        queryClient.setQueryData(
          queryKeys.workflows.instance(variables.workflowId, instanceId),
          queuedInstancePlaceholder(
            variables.workflowId,
            instanceId,
            variables.version
          )
        );
        queuedRunRef.current = { instanceId, queuedAt: Date.now() };

        // Start execution visualization (debugMode enables step-event polling)
        startExecution(instanceId, variables.workflowId, variables.trackEvents);
      }
    },
  });

  // Poll instance data for execution visualization
  const { data: executionInstanceData, refetch: refetchInstanceData } =
    useCustomQuery({
      queryKey: queryKeys.workflows.instance(
        workflowId ?? '',
        executingInstanceId ?? ''
      ),
      queryFn: async (token: string) => {
        // Reading a run this page has only just queued would 404 — the runtime
        // has not written its row yet. Only that run waits; anything else,
        // including an instance attached to on load, reads straight away.
        await holdForQueuedRow(queuedRunRef.current, executingInstanceId!);
        return getWorkflowInstance(token, workflowId!, executingInstanceId!);
      },
      enabled: !!executingInstanceId,
      // The seeded queued status is for display only. Without this it would
      // count as fresh under the client's 5-minute default and suppress the
      // read that follows, leaving the run's real status to the poll below —
      // which a hidden tab skips entirely.
      staleTime: 0,
      refetchInterval: (query: any) => {
        const status = query.state.data?.status;
        const isActive =
          status && ['queued', 'compiling', 'running'].includes(status);
        // Also keep polling (slower) when suspended to detect resume completion
        return isActive ? 2000 : status === 'suspended' ? 3000 : false;
      },
    });

  // Poll step events (only in debug/trackEvents mode)
  const { data: executionStepEventsData, refetch: refetchStepEvents } =
    useCustomQuery({
      queryKey: queryKeys.workflows.stepEvents(
        workflowId,
        executingInstanceId ?? undefined
      ),
      queryFn: (token: string) =>
        getStepEvents(token, workflowId!, executingInstanceId!),
      enabled: !!executingInstanceId && executionDebugMode,
      refetchInterval: () => {
        // Keep polling while instance is active or suspended
        const status = executionInstanceData?.status;
        const isActive =
          status && ['queued', 'compiling', 'running'].includes(status);
        // Poll more frequently (500ms) in debug mode to catch intermediate states
        return isActive || status === 'suspended' ? 500 : false;
      },
    });

  // Initialize all nodes with queued status when execution starts
  useEffect(() => {
    if (!executingInstanceId) return;

    const { nodes } = useWorkflowStore.getState();

    // Set all nodes (except start and create nodes) to queued status initially
    nodes.forEach((node) => {
      if (node.id !== 'start' && node.type !== 'CreateNode') {
        updateNodeStatus(node.id, {
          status: 'queued',
        });
      }
    });
  }, [executingInstanceId, updateNodeStatus]);

  // Reattach to a suspended execution when navigating with ?attachInstance=<id>
  useEffect(() => {
    const attachInstanceId = searchParams.get('attachInstance');
    if (!attachInstanceId || !workflowId) return;
    // Only attach if we're not already tracking an execution
    if (executingInstanceId) return;

    // Remove the query param so it doesn't re-trigger
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('attachInstance');
        return next;
      },
      { replace: true }
    );

    // Attach to the instance — enable step event polling (debugMode=true) and mark as debug execution
    startExecution(attachInstanceId, workflowId, true);
  }, [
    searchParams,
    workflowId,
    executingInstanceId,
    startExecution,
    setSearchParams,
  ]);

  // Track the last instance ID we did a final refetch for
  const lastFinalRefetchInstanceId = useRef<string | null>(null);
  const finalRefetchRetryCountRef = useRef<number>(0);

  // Helper to check if all step events have completed (have both start and end events)
  const checkAllStepsCompleted = useCallback((eventsData: any): boolean => {
    const events = eventsData?.data?.events || [];
    if (events.length === 0) return true; // No events means nothing to check

    const startEvents = new Set<string>();
    const endEvents = new Set<string>();

    for (const event of events) {
      if (event.subtype === 'step_debug_start' && event.payload?.step_id) {
        startEvents.add(event.payload.step_id);
      } else if (event.subtype === 'step_debug_end' && event.payload?.step_id) {
        endEvents.add(event.payload.step_id);
      }
    }

    // All steps that started should have ended
    for (const stepId of startEvents) {
      if (!endEvents.has(stepId)) {
        return false;
      }
    }
    return true;
  }, []);

  // Do a final refetch when execution reaches terminal state
  useEffect(() => {
    if (!executionInstanceData?.status || !executingInstanceId) return;

    const terminalStates = ['completed', 'failed', 'timeout', 'cancelled'];

    // If execution just finished and we haven't done final refetch for this instance yet
    if (
      terminalStates.includes(executionInstanceData.status) &&
      lastFinalRefetchInstanceId.current !== executingInstanceId
    ) {
      lastFinalRefetchInstanceId.current = executingInstanceId;
      finalRefetchRetryCountRef.current = 0;

      // Recursive function to retry fetching step events until all are completed
      let cancelled = false;
      const fetchWithRetry = async (retryCount: number, maxRetries: number) => {
        if (cancelled) return;
        await refetchInstanceData();

        if (cancelled || !executionDebugMode) return;
        const result = await refetchStepEvents();
        const allCompleted = checkAllStepsCompleted(result.data);

        if (!cancelled && !allCompleted && retryCount < maxRetries) {
          finalRefetchRetryCountRef.current = retryCount + 1;
          setTimeout(() => fetchWithRetry(retryCount + 1, maxRetries), 500);
        }
      };

      // Delay initial fetch to allow backend to finalize data, then retry if needed
      const timer = setTimeout(() => fetchWithRetry(0, 5), 300);

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [
    executingInstanceId,
    executionInstanceData?.status,
    executionDebugMode,
    refetchInstanceData,
    refetchStepEvents,
    checkAllStepsCompleted,
  ]);

  // Update node statuses based on execution data
  useEffect(() => {
    // Don't update if execution was cleared (executingInstanceId is null)
    if (!executingInstanceId || !executionInstanceData) return;

    // Verify this data is for the current execution instance
    // This prevents processing stale data from previous executions
    if (executionInstanceData.id !== executingInstanceId) {
      return;
    }

    // Update instance status in store
    if (executionInstanceData.status) {
      updateInstanceStatus(executionInstanceData.status);
    }

    // Detect a stop at a breakpoint (or an explicit pause) in a debug
    // execution. Only a `paused` suspension counts: a run parked on a signal,
    // child runs or a timer is waiting and wakes on its own, so it must not
    // offer breakpoint Continue.
    // NOTE: this block must NOT early-return — the node status mapping below must always run.
    // Runtime events name a step by its DSL id; a step id shared by two
    // subgraphs is told apart by the event's iteration scope.
    const resolveNodeId = createStepNodeResolver(
      useWorkflowStore.getState().nodes
    );
    const atBreakpoint = isAtBreakpoint(executionInstanceData);
    const waitingSuspension = isWaitingSuspension(executionInstanceData);
    if (atBreakpoint && !justResumedRef.current) {
      // Look for the LATEST breakpoint_hit event
      const events = executionStepEventsData?.data?.events;
      if (events) {
        // Events are returned newest-first from the API — take the first breakpoint_hit (current one)
        const latestBreakpoint =
          events.find(
            (e: any) =>
              e.eventType === 'custom' && e.subtype === 'breakpoint_hit'
          ) ?? null;

        const hitKey = latestBreakpoint?.payload
          ? breakpointKey(executingInstanceId, latestBreakpoint)
          : null;
        if (
          latestBreakpoint?.payload &&
          hitKey &&
          hitKey !== lastProcessedBreakpointRef.current
        ) {
          lastProcessedBreakpointRef.current = hitKey;
          setSuspended(true, {
            stepId: resolveNodeId(
              latestBreakpoint.payload.step_id,
              latestBreakpoint.payload.scope_id
            ),
            stepName: latestBreakpoint.payload.step_name,
            stepType: latestBreakpoint.payload.step_type,
            inputs: latestBreakpoint.payload.inputs ?? null,
            stepsContext: latestBreakpoint.payload.steps_context || {},
          });
        } else if (!latestBreakpoint?.payload && !isSuspended) {
          // Step events don't have breakpoint_hit yet — force immediate refetch
          setSuspended(true, null);
          refetchStepEvents();
        }
      } else if (!isSuspended) {
        // No step events data yet — force immediate refetch
        setSuspended(true, null);
        refetchStepEvents();
      }
    } else if (!atBreakpoint) {
      // Not stopped at a breakpoint — clear the justResumed guard once the run
      // has left the suspended state, and drop any breakpoint state.
      if (
        justResumedRef.current &&
        executionInstanceData.status !== 'suspended'
      ) {
        justResumedRef.current = false;
      }
      if (isSuspended) {
        setSuspended(false, null);
      }
    }

    // Map steps to nodes
    if (executionDebugMode && executionStepEventsData?.data?.events) {
      // Debug mode: process raw events by pairing start and end events
      const rawEvents = executionStepEventsData.data.events;

      // Sort events by id to process in order
      const sortedEvents = [...rawEvents].sort((a: any, b: any) => a.id - b.id);

      // Track start events and build paired step data
      const startEvents = new Map<string, any>();
      const processedSteps = new Map<
        string,
        {
          status: ExecutionStatus;
          startedAt?: string;
          executionTime?: number;
          error?: string;
        }
      >();

      for (const event of sortedEvents) {
        const nodeId = event.payload?.step_id
          ? resolveNodeId(event.payload.step_id, event.payload.scope_id)
          : undefined;
        if (event.subtype === 'step_debug_start' && nodeId) {
          // Store start event
          startEvents.set(nodeId, event);

          // Mark step as Running
          const timestamp = event.payload.timestamp_ms
            ? new Date(event.payload.timestamp_ms).toISOString()
            : undefined;
          processedSteps.set(nodeId, {
            status: 'running',
            startedAt: timestamp,
          });

          // Store step inputs for debug inspector
          if (event.payload.inputs !== undefined) {
            setStepDebugData(nodeId, {
              inputs: event.payload.inputs,
            });
          }
        } else if (event.subtype === 'step_debug_end' && nodeId) {
          // Find matching start event
          const startEvent = startEvents.get(nodeId);
          const startTimestamp = startEvent?.payload?.timestamp_ms
            ? new Date(startEvent.payload.timestamp_ms).toISOString()
            : undefined;

          // Determine status from end event payload
          const hasError = !!event.payload.error;
          const status = hasError ? 'failed' : 'completed';

          processedSteps.set(nodeId, {
            status,
            startedAt: startTimestamp,
            executionTime: event.payload.duration_ms || undefined,
            error: event.payload.error || undefined,
          });

          // Store step outputs for debug inspector
          setStepDebugData(nodeId, {
            outputs: event.payload.outputs,
            durationMs: event.payload.duration_ms,
            error: event.payload.error || undefined,
          });
        }
      }

      // Update node statuses for all processed steps. A step still open while
      // the run waits (signal, child runs, timer) is parked, not running.
      const executedStepIds = new Set(processedSteps.keys());
      for (const [stepId, stepData] of processedSteps) {
        updateNodeStatus(
          stepId,
          waitingSuspension && stepData.status === 'running'
            ? { ...stepData, status: 'suspended' }
            : stepData
        );
      }

      // After mapping all step events, apply Suspended highlight to the current breakpoint step.
      // This must run AFTER the loop above so it overrides the step_debug_start "Running" status.
      const currentBp = useExecutionStore.getState().breakpointHit;
      if (isSuspended && currentBp?.stepId) {
        updateNodeStatus(currentBp.stepId, {
          status: 'suspended',
        });
      }

      // If execution is finished, clear status for nodes that weren't executed (skipped)
      const isExecutionTerminal = [
        'completed',
        'failed',
        'timeout',
        'cancelled',
      ].includes(executionInstanceData.status);

      if (isExecutionTerminal) {
        const { nodes } = useWorkflowStore.getState();
        const currentStore = useExecutionStore.getState();
        const skippedNodeIds: string[] = [];

        nodes.forEach((node) => {
          if (node.id === 'start' || node.type === 'CreateNode') return;

          const currentStatus = currentStore.nodeExecutionStatus.get(node.id);
          if (
            currentStatus?.status === 'queued' &&
            !executedStepIds.has(node.id)
          ) {
            skippedNodeIds.push(node.id);
          }
        });

        if (skippedNodeIds.length > 0) {
          const newMap = new Map(currentStore.nodeExecutionStatus);
          skippedNodeIds.forEach((nodeId) => newMap.delete(nodeId));

          useExecutionStore.setState({
            nodeExecutionStatus: newMap,
            statusVersion: currentStore.statusVersion + 1,
          });
        }
      }
    } else if (
      executionInstanceData.steps &&
      executionInstanceData.steps.length > 0
    ) {
      // Non-debug mode with step details available
      const isExecutionTerminal = [
        'completed',
        'failed',
        'timeout',
        'cancelled',
      ].includes(executionInstanceData.status);

      // Get all step IDs that were actually executed
      const executedStepIds = new Set(
        executionInstanceData.steps.map((step: any) => step.id)
      );

      executionInstanceData.steps.forEach((step: any) => {
        const status = step.finished
          ? 'completed'
          : step.started
            ? waitingSuspension
              ? 'suspended'
              : 'running'
            : isExecutionTerminal
              ? executionInstanceData.status
              : 'queued';

        updateNodeStatus(step.id, {
          status,
          startedAt: step.started || undefined,
          completedAt: step.finished || undefined,
          executionTime: step.executionTime || undefined,
        });
      });

      // If execution is finished, clear status for nodes that weren't executed (skipped)
      if (isExecutionTerminal) {
        const { nodes } = useWorkflowStore.getState();
        const currentStore = useExecutionStore.getState();
        const skippedNodeIds: string[] = [];

        // Find all nodes that are queued but weren't executed
        nodes.forEach((node) => {
          // Skip start and create nodes
          if (node.id === 'start' || node.type === 'CreateNode') return;

          // If node has queued status but wasn't in the executed steps, it was skipped
          const currentStatus = currentStore.nodeExecutionStatus.get(node.id);
          if (
            currentStatus?.status === 'queued' &&
            !executedStepIds.has(node.id)
          ) {
            skippedNodeIds.push(node.id);
          }
        });

        // Clear status for all skipped nodes in one update
        if (skippedNodeIds.length > 0) {
          const newMap = new Map(currentStore.nodeExecutionStatus);
          skippedNodeIds.forEach((nodeId) => newMap.delete(nodeId));

          useExecutionStore.setState({
            nodeExecutionStatus: newMap,
            statusVersion: currentStore.statusVersion + 1,
          });
        }
      }
    } else {
      // Non-debug mode without step details: apply overall status to all nodes
      const { nodes } = useWorkflowStore.getState();

      // Update all nodes except the start node
      nodes.forEach((node) => {
        if (node.id !== 'start' && node.type !== 'CreateNode') {
          updateNodeStatus(node.id, {
            status: executionInstanceData.status,
          });
        }
      });
    }
  }, [
    executingInstanceId,
    executionInstanceData,
    executionStepEventsData,
    executionDebugMode,
    isSuspended,
    updateNodeStatus,
    updateInstanceStatus,
    setSuspended,
    setStepDebugData,
    refetchStepEvents,
  ]);

  // ── Resume from breakpoint ──────────────────────────────────────────────
  // Track that we just resumed to prevent stale "suspended" data from re-triggering
  const justResumedRef = useRef(false);
  // The last breakpoint hit we acted on (see breakpointKey) — persists across
  // resume so the same hit is not offered twice
  const lastProcessedBreakpointRef = useRef<string | null>(null);

  const resumeMutation = useCustomMutation({
    mutationFn: resumeInstance,
    onSuccess: () => {
      justResumedRef.current = true;
      setSuspended(false, null);
      // Force immediate refetch so polling picks up the new status
      refetchInstanceData();
      refetchStepEvents();
      // Safety: clear the guard after 5s in case polling never sees a non-suspended status
      setTimeout(() => {
        justResumedRef.current = false;
      }, 5000);
      toast.info('Execution resumed');
    },
  });

  const handleResume = () => {
    if (!executingInstanceId) {
      toast.error('No active execution to resume');
      return;
    }
    resumeMutation.mutate(executingInstanceId);
  };

  // ── Stop execution ──────────────────────────────────────────────────
  const stopMutation = useCustomMutation({
    mutationFn: stopInstance,
    onSuccess: () => {
      resetExecution();
      toast.info('Execution stopped');
    },
  });

  const handleStop = () => {
    if (!executingInstanceId) {
      toast.error('No active execution to stop');
      return;
    }
    stopMutation.mutate(executingInstanceId);
  };

  const handleResetExecution = () => {
    resetExecution();
    useWorkflowStore.getState().setSelectedNodeId(null);
    lastProcessedBreakpointRef.current = null;
    justResumedRef.current = false;
  };

  return {
    scheduleMutation,
    executingInstanceId,
    executionInstanceData,
    isSuspended,
    resumeMutation,
    stopMutation,
    handleResume,
    handleStop,
    handleResetExecution,
  };
}

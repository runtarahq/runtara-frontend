import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { deliverSignal, getPendingInput } from '../../queries';
import {
  InputSubmissionError,
  InputSubmissionTracker,
  isClosedInputSubmission,
  isStaleInputSubmission,
} from '../../utils/input-submission';
import type { WaitingForInputData } from '../../types/chat';

interface UncertainResponse {
  operationId: string;
  instanceId: string;
  workflowId: string;
  request: WaitingForInputData;
  payload: Record<string, unknown>;
}

/**
 * The pending inputs of a run that no conversation started (one opened from
 * its history): they are polled for, and answered on the run. Discovery is
 * independent of optional SSE/debug events and the stream lifetime.
 */
export function useChatInputs(workflowId: string, token: string) {
  const instanceId = useChatStore((state) => state.instanceId);
  const conversationKey = useChatStore((state) => state.conversationKey);
  const generation = useRef(0);
  const submitting = useRef(false);
  const submissions = useRef(new InputSubmissionTracker());
  const uncertain = useRef(new Map<string, UncertainResponse>());
  const [uncertainResponses, setUncertainResponses] = useState<
    UncertainResponse[]
  >([]);

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      const owner = useChatStore.getState();
      // A conversation announces what its run waits for, and is answered
      // through: only a run that no conversation started is asked.
      if (
        !owner.instanceId ||
        owner.conversationKey ||
        owner.workflowId !== workflowId ||
        submitting.current
      )
        return false;
      const version = ++generation.current;
      const isCurrent = () => {
        const current = useChatStore.getState();
        return (
          !signal?.aborted &&
          version === generation.current &&
          current.workflowId === workflowId &&
          current.instanceId === owner.instanceId &&
          !current.conversationKey
        );
      };
      try {
        // What a run waits for is read from the run: the conversation says
        // which run carries it now (`run_started`).
        const page = {
          instanceId: owner.instanceId,
          pendingInputs: await getPendingInput(
            token,
            workflowId,
            owner.instanceId,
            signal
          ),
        };
        if (!isCurrent()) return false;
        const pending: WaitingForInputData[] = page.pendingInputs.map(
          (request) => ({ ...request, instanceId: page.instanceId })
        );
        const retries = uncertain.current.values();
        // A lost acceptance acknowledgement must remain retryable even when discovery
        // already excludes the accepted request. Keep its original form until resolved.
        for (const retry of retries) {
          if (
            retry.workflowId === workflowId &&
            retry.instanceId === owner.instanceId &&
            !pending.some(
              (item) =>
                item.requestId === retry.request.requestId &&
                item.instanceId === retry.instanceId
            )
          )
            pending.push(retry.request);
        }
        owner.setPendingInputs(pending);
        return true;
      } catch (error) {
        if (isCurrent())
          owner.setPendingInputError(
            error instanceof Error
              ? error.message
              : 'Pending inputs are unavailable'
          );
        return false;
      }
    },
    [workflowId, token]
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 3000;
    const poll = async () => {
      const succeeded = await refresh(controller.signal);
      delay = succeeded ? 3000 : Math.min(delay * 2, 30000);
      if (!controller.signal.aborted) timer = setTimeout(poll, delay);
    };
    if (instanceId && !conversationKey) void poll();
    return () => {
      controller.abort();
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [instanceId, conversationKey, refresh]);

  const submitInput = useCallback(
    async (
      requestId: string,
      payload: Record<string, unknown>,
      instanceId?: string,
      retryOperationId?: string
    ): Promise<boolean> => {
      const owner = useChatStore.getState();
      const retained = retryOperationId
        ? uncertain.current.get(retryOperationId)
        : undefined;
      const request =
        owner.pendingInputs.find(
          (item) =>
            item.requestId === requestId &&
            (!instanceId || item.instanceId === instanceId)
        ) ??
        (retained?.workflowId === workflowId ? retained.request : undefined);
      if (
        !owner.instanceId ||
        owner.conversationKey ||
        !request ||
        submitting.current
      )
        return false;
      const targetInstanceId = request.instanceId ?? owner.instanceId;
      const submission =
        retained &&
        retained.instanceId === targetInstanceId &&
        retained.request.requestId === requestId
          ? {
              requestId,
              operationId: retained.operationId,
              payload: retained.payload,
            }
          : submissions.current.prepare(targetInstanceId, requestId, payload);
      const retryKey = submission.operationId;
      const isOtherRequest = (item: WaitingForInputData) =>
        item.requestId !== requestId ||
        (item.instanceId ?? owner.instanceId) !== targetInstanceId;
      generation.current += 1;
      const isCurrent = () => {
        const current = useChatStore.getState();
        return (
          current.workflowId === owner.workflowId &&
          !current.conversationKey &&
          current.instanceId === owner.instanceId
        );
      };
      submitting.current = true;
      owner.setError(null);
      try {
        await deliverSignal(token, targetInstanceId, submission);
        if (!isCurrent()) return false;
        uncertain.current.delete(retryKey);
        owner.setPendingInputs(
          useChatStore.getState().pendingInputs.filter(isOtherRequest)
        );
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        if (isStaleInputSubmission(error)) {
          uncertain.current.delete(retryKey);
          if (isClosedInputSubmission(error)) {
            // Closed unanswered: an earlier uncertain operation on the same
            // request cannot have been accepted, so its form must not return.
            for (const [key, retry] of uncertain.current) {
              if (
                retry.instanceId === targetInstanceId &&
                retry.request.requestId === requestId
              )
                uncertain.current.delete(key);
            }
          }
          owner.setPendingInputs(
            useChatStore.getState().pendingInputs.filter(isOtherRequest)
          );
        } else if (
          !(error instanceof InputSubmissionError) ||
          !error.status ||
          error.status >= 500
        ) {
          uncertain.current.set(retryKey, {
            operationId: submission.operationId,
            instanceId: targetInstanceId,
            workflowId,
            request: { ...request, instanceId: targetInstanceId },
            payload: submission.payload,
          });
        }
        owner.setError(
          error instanceof Error
            ? error.message
            : 'Response could not be confirmed. Retry the same response.'
        );
        return false;
      } finally {
        submitting.current = false;
        setUncertainResponses([...uncertain.current.values()]);
        if (isCurrent()) void refresh();
      }
    },
    [refresh, token, workflowId]
  );

  return {
    refreshPendingInput: refresh,
    submitInput,
    uncertainResponses: uncertainResponses.filter(
      (response) =>
        response.workflowId === workflowId && response.instanceId === instanceId
    ),
  };
}

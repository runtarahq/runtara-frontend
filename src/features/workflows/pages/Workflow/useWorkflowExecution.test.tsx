import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scheduleWorkflow: vi.fn(),
  getWorkflowInstance: vi.fn(),
  getStepEvents: vi.fn(),
  resumeInstance: vi.fn(),
  stopInstance: vi.fn(),
  toast: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/bootstrap', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
  };
});
vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ user: { access_token: 'token-1' } }),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/features/workflows/queries', () => ({
  scheduleWorkflow: mocks.scheduleWorkflow,
  getWorkflowInstance: mocks.getWorkflowInstance,
  getStepEvents: mocks.getStepEvents,
  resumeInstance: mocks.resumeInstance,
  stopInstance: mocks.stopInstance,
  // The run is readable at once: no wait for the runtime to write its row.
  holdForQueuedRow: async () => {},
  queuedInstancePlaceholder: (workflowId: string, id: string) => ({
    id,
    workflowId,
    status: 'queued',
  }),
}));

import { queryClient } from '@/bootstrap';
import { useExecutionStore } from '@/features/workflows/stores/executionStore';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useWorkflowExecution } from './useWorkflowExecution';

let search = '';
const run = (url = '/workflows/wf-1') =>
  renderHook(
    () => {
      search = useLocation().search;
      return useWorkflowExecution('wf-1');
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[url]}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </MemoryRouter>
      ),
    }
  );

// In steps, each flushed through React: a poll that settles renders, and
// that render's effects react to it.
const advance = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }
};

const instance = (status: string, over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  workflowId: 'wf-1',
  status,
  ...over,
});
const stepEvent = (
  id: number,
  subtype: string,
  payload: Record<string, unknown>
) => ({ id, eventType: 'custom', subtype, payload });
const node = (id: string, type = 'BASIC_NODE') => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { id, name: id, stepType: 'Agent' },
});

const start = async (trackEvents = false) => {
  const hook = run();
  await act(async () => {
    hook.result.current.scheduleMutation.mutate({
      workflowId: 'wf-1',
      trackEvents,
    });
  });
  await advance(100);
  return hook;
};
const status = (id: string) =>
  useExecutionStore.getState().nodeExecutionStatus.get(id)?.status;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient.clear();
  useExecutionStore.getState().resetExecution();
  useWorkflowStore.getState().resetState();
  useWorkflowStore.setState({ nodes: [node('a'), node('b')] });
  for (const mock of Object.values(mocks)) {
    if ('mockReset' in mock) mock.mockReset();
  }
  mocks.toast.info.mockReset();
  mocks.toast.error.mockReset();
  mocks.scheduleWorkflow.mockResolvedValue({
    data: { instanceId: 'run-1', status: 'queued' },
  });
  mocks.getWorkflowInstance.mockResolvedValue(instance('running'));
  mocks.getStepEvents.mockResolvedValue({ data: { events: [] } });
  mocks.stopInstance.mockResolvedValue({});
  mocks.resumeInstance.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkflowExecution', () => {
  it('follows nothing until a run is started', async () => {
    const { result } = run();
    await advance(3000);
    expect(result.current.executingInstanceId).toBeNull();
    expect(mocks.getWorkflowInstance).not.toHaveBeenCalled();
  });

  it('starts a run: its steps are queued and its status is followed', async () => {
    mocks.getWorkflowInstance.mockResolvedValue(instance('queued'));
    const { result } = await start();
    expect(mocks.scheduleWorkflow).toHaveBeenCalledWith(
      'wf-1',
      undefined,
      undefined,
      undefined
    );
    expect(result.current.executingInstanceId).toBe('run-1');
    expect(status('a')).toBe('queued');
    expect(status('b')).toBe('queued');
    expect(mocks.getWorkflowInstance).toHaveBeenCalledWith('wf-1', 'run-1');
    expect(useExecutionStore.getState().instanceStatus).toBe('queued');
  });

  it('keeps asking while the run is live, and stops once it has ended', async () => {
    await start();
    const afterStart = mocks.getWorkflowInstance.mock.calls.length;
    await advance(4200);
    expect(mocks.getWorkflowInstance.mock.calls.length).toBeGreaterThanOrEqual(
      afterStart + 2
    );

    mocks.getWorkflowInstance.mockResolvedValue(instance('completed'));
    await advance(2500);
    expect(useExecutionStore.getState().instanceStatus).toBe('completed');
    // One last read once it ends, then none.
    await advance(1000);
    const settled = mocks.getWorkflowInstance.mock.calls.length;
    await advance(6000);
    expect(mocks.getWorkflowInstance.mock.calls.length).toBe(settled);
  });

  it('reads step events only for a run that tracks them', async () => {
    await start(false);
    await advance(2000);
    expect(mocks.getStepEvents).not.toHaveBeenCalled();
  });

  it('shows each step as its events report it', async () => {
    mocks.getStepEvents.mockResolvedValue({
      data: {
        events: [
          stepEvent(1, 'step_debug_start', { step_id: 'a', timestamp_ms: 1 }),
          stepEvent(2, 'step_debug_end', {
            step_id: 'a',
            duration_ms: 40,
            outputs: { ok: true },
          }),
          stepEvent(3, 'step_debug_start', { step_id: 'b', timestamp_ms: 50 }),
        ],
      },
    });
    await start(true);
    await advance(1200);
    expect(mocks.getStepEvents).toHaveBeenCalledWith('wf-1', 'run-1');
    expect(status('a')).toBe('completed');
    expect(status('b')).toBe('running');
    expect(useExecutionStore.getState().stepDebugData.get('a')).toMatchObject({
      outputs: { ok: true },
      durationMs: 40,
    });
  });

  it('shows a step that ended with an error as failed', async () => {
    mocks.getStepEvents.mockResolvedValue({
      data: {
        events: [
          stepEvent(1, 'step_debug_start', { step_id: 'a', timestamp_ms: 1 }),
          stepEvent(2, 'step_debug_end', { step_id: 'a', error: 'boom' }),
        ],
      },
    });
    await start(true);
    await advance(1200);
    expect(status('a')).toBe('failed');
  });

  it('attaches to the run the address names, and takes it out of the address', async () => {
    const { result } = run('/workflows/wf-1?attachInstance=run-9&tab=x');
    await advance(100);
    expect(result.current.executingInstanceId).toBe('run-9');
    expect(useExecutionStore.getState().debugMode).toBe(true);
    expect(search).toBe('?tab=x');
    expect(mocks.getWorkflowInstance).toHaveBeenCalledWith('wf-1', 'run-9');
  });

  it('stops the run and lets go of it', async () => {
    const { result } = await start();
    await act(async () => result.current.handleStop());
    await advance(100);
    expect(mocks.stopInstance).toHaveBeenCalledWith('run-1');
    expect(result.current.executingInstanceId).toBeNull();
    expect(mocks.toast.info).toHaveBeenCalledWith('Execution stopped');
  });

  it('resumes the run and says so', async () => {
    const { result } = await start(true);
    await act(async () => result.current.handleResume());
    await advance(100);
    expect(mocks.resumeInstance).toHaveBeenCalledWith('run-1');
    expect(mocks.toast.info).toHaveBeenCalledWith('Execution resumed');
    expect(result.current.isSuspended).toBe(false);
  });

  it('refuses to stop or resume when there is no run', async () => {
    const { result } = run();
    await act(async () => {
      result.current.handleStop();
      result.current.handleResume();
    });
    expect(mocks.stopInstance).not.toHaveBeenCalled();
    expect(mocks.resumeInstance).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'No active execution to stop'
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'No active execution to resume'
    );
  });

  it('clears the run and the selection on reset', async () => {
    const { result } = await start();
    act(() => useWorkflowStore.getState().setSelectedNodeId('a'));
    act(() => result.current.handleResetExecution());
    expect(result.current.executingInstanceId).toBeNull();
    expect(useWorkflowStore.getState().selectedNodeId).toBeNull();
    expect(useExecutionStore.getState().nodeExecutionStatus.size).toBe(0);
  });
});

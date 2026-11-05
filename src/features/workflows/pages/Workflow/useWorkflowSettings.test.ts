import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useWorkflowSettings,
  type WorkflowChanges,
} from './useWorkflowSettings';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';

describe('useWorkflowSettings', () => {
  beforeEach(() => useWorkflowStore.getState().resetState());

  it('updates an explicit reset even when the staged property value stays undefined', () => {
    const data = { memoryMb: 256, entryPoint: 'first', durable: true };
    const { result, rerender } = renderHook(
      ({ changes }: { changes: WorkflowChanges }) =>
        useWorkflowSettings('workflow', data, changes),
      { initialProps: { changes: {} } }
    );
    expect(result.current.memoryMb).toBe(256);
    rerender({ changes: { memoryMb: undefined, entryPoint: undefined } });
    expect(result.current.memoryMb).toBeUndefined();
    expect(result.current.entryPoint).toBeUndefined();
    expect(result.current.durable).toBe(true);
  });

  it('preserves staged nulls, false values, and empty collections', () => {
    const { result } = renderHook(() =>
      useWorkflowSettings(
        'workflow',
        { memoryMb: 256, durable: true, trackEvents: true },
        { memoryMb: null, durable: null, trackEvents: false, variables: [] }
      )
    );
    expect(result.current).toMatchObject({
      memoryMb: null,
      durable: null,
      trackEvents: false,
      variables: [],
    });
  });
});

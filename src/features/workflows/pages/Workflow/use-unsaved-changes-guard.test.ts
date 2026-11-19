import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { useNavigationBlockerStore } from '@/shared/stores/navigationBlockerStore';
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard';
import type { WorkflowChanges } from './workflow-settings';

type Props = { isSwitchingVersion: boolean; staged: WorkflowChanges };
const discard = vi.fn();

const guard = (initial: Partial<Props> = {}) =>
  renderHook(
    ({ isSwitchingVersion, staged }: Props) =>
      useUnsavedChangesGuard({
        isSwitchingVersion,
        stagedWorkflowChanges: staged,
        discardStagedChanges: discard,
      }),
    { initialProps: { isSwitchingVersion: false, staged: {}, ...initial } }
  );

const editCanvas = (structural: boolean) =>
  act(() =>
    useWorkflowStore.setState({
      isDirty: true,
      isStructurallyDirty: structural,
    })
  );

beforeEach(() => {
  useWorkflowStore.getState().resetState();
  useNavigationBlockerStore.getState().reset();
  discard.mockReset();
});

describe('useUnsavedChangesGuard', () => {
  it('has nothing unsaved on a workflow as it was loaded', () => {
    const { result } = guard();
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.hasStructuralUnsavedChanges).toBe(false);
    expect(useNavigationBlockerStore.getState().shouldBlock).toBe(false);
  });

  it('counts a moved step as unsaved, but not as a change of structure', () => {
    const { result } = guard();
    editCanvas(false);
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.hasStructuralUnsavedChanges).toBe(false);
  });

  it('counts an edited step and a staged setting as both', () => {
    const edited = guard();
    editCanvas(true);
    expect(edited.result.current.hasStructuralUnsavedChanges).toBe(true);
    edited.unmount();

    useWorkflowStore.getState().resetState();
    const staged = guard({ staged: { description: 'New' } });
    expect(staged.result.current.hasUnsavedChanges).toBe(true);
    expect(staged.result.current.hasStructuralUnsavedChanges).toBe(true);
  });

  it('has nothing unsaved while a version is being switched to', () => {
    const { result } = guard({
      isSwitchingVersion: true,
      staged: { description: 'New' },
    });
    editCanvas(true);
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.hasStructuralUnsavedChanges).toBe(false);
  });

  it('runs an action at once when nothing would be lost', () => {
    const { result } = guard();
    const action = vi.fn();
    act(() => result.current.confirmIfUnsavedChanges(action));
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.isUnsavedChangesDialogOpen).toBe(false);
  });

  it('holds an action that would lose work until it is confirmed', () => {
    const { result } = guard({ staged: { description: 'New' } });
    const action = vi.fn();
    act(() => result.current.confirmIfUnsavedChanges(action));
    expect(action).not.toHaveBeenCalled();
    expect(result.current.isUnsavedChangesDialogOpen).toBe(true);

    act(() => result.current.handleConfirmUnsavedChanges());
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.isUnsavedChangesDialogOpen).toBe(false);
  });

  it('drops a held action that is cancelled, for good', () => {
    const { result } = guard({ staged: { description: 'New' } });
    const action = vi.fn();
    act(() => result.current.confirmIfUnsavedChanges(action));
    act(() => result.current.handleCancelUnsavedChanges());
    expect(result.current.isUnsavedChangesDialogOpen).toBe(false);
    // A later confirm has nothing left to run.
    act(() => result.current.handleConfirmUnsavedChanges());
    expect(action).not.toHaveBeenCalled();
  });

  it('blocks leaving the page while there is unsaved work, and not after', () => {
    const { rerender, unmount } = guard({ staged: { description: 'New' } });
    expect(useNavigationBlockerStore.getState().shouldBlock).toBe(true);
    rerender({ isSwitchingVersion: false, staged: {} });
    expect(useNavigationBlockerStore.getState().shouldBlock).toBe(false);
    rerender({ isSwitchingVersion: false, staged: { name: 'x' } });
    unmount();
    expect(useNavigationBlockerStore.getState().shouldBlock).toBe(false);
  });

  it('discards the staged settings and the canvas edits when leaving is confirmed', () => {
    guard({ staged: { description: 'New' } });
    editCanvas(true);
    act(() => useNavigationBlockerStore.getState().confirmNavigation());
    expect(discard).toHaveBeenCalledOnce();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });
});

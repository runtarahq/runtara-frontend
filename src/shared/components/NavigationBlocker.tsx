import { useEffect, useCallback } from 'react';
import { useBlocker, type Location } from 'react-router';
import { useNavigationBlockerStore } from '@/shared/stores/navigationBlockerStore';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';

export function NavigationBlocker() {
  const {
    shouldBlock,
    isDialogOpen,
    setBlockerFunctions,
    openDialog,
    confirmNavigation,
    cancelNavigation,
  } = useNavigationBlockerStore();

  // Use the blocker at the layout level where it won't be unmounted
  const blocker = useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: Location;
        nextLocation: Location;
      }) => {
        return (
          shouldBlock && currentLocation.pathname !== nextLocation.pathname
        );
      },
      [shouldBlock]
    )
  );

  // When blocker becomes blocked, store the proceed/reset functions and show dialog
  useEffect(() => {
    if (blocker.state === 'blocked') {
      setBlockerFunctions(blocker.proceed, blocker.reset);
      openDialog();
    }
  }, [
    blocker.state,
    blocker.proceed,
    blocker.reset,
    setBlockerFunctions,
    openDialog,
  ]);

  return (
    <UnsavedChangesDialog
      open={isDialogOpen}
      onConfirm={confirmNavigation}
      onCancel={cancelNavigation}
      title="Unsaved changes"
      description="You have unsaved changes. If you leave now, they'll be discarded."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
    />
  );
}

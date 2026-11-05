import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/shared/components/ui/alert-dialog';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function UnsavedChangesDialog({
  open,
  onConfirm,
  onCancel,
  title = 'Unsaved Changes',
  description = 'You have unsaved changes that will be lost. Are you sure you want to continue?',
  confirmLabel = 'Discard Changes',
  cancelLabel = 'Cancel',
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent className="p-6">
        <AlertDialogHeader className="pb-4">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="pt-2">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-4">
          <AlertDialogCancel
            onClick={(event) => {
              // The parent owns closing. Prevent Radix's implicit close from
              // dispatching onCancel a second time (including keyboard clicks).
              event.preventDefault();
              onCancel();
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-warning text-warning-foreground hover:bg-warning/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

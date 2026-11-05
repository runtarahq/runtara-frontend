import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog.tsx';
import { Button } from '@/shared/components/ui/button.tsx';
import React from 'react';

const DEFAULT_TITLE = 'Are you absolutely sure?';
const DEFAULT_DESCRIPTION = 'This action will delete this entity.';

interface ConfirmationDialogProps {
  children?: React.ReactNode;
  open: boolean;
  title?: string;
  description?: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * A confirmation dialog component for destructive or important actions.
 * Use this for delete confirmations, clone confirmations, etc.
 *
 * For simple dialogs that just wrap content, use SimpleDialog from next-dialog.
 * Use Dialog and DialogContent for custom form dialogs.
 */
export function ConfirmationDialog(props: ConfirmationDialogProps) {
  const {
    children = null,
    open = false,
    title = DEFAULT_TITLE,
    description = DEFAULT_DESCRIPTION,
    loading = false,
    onClose,
    onConfirm,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {loading && 'Loading..'}
        {children && !loading && children}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

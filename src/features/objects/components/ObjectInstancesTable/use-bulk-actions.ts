import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
  useBulkCreateObjectInstances,
  useBulkDeleteObjectInstances,
  useBulkUpdateObjectInstances,
} from '@/features/objects/hooks/useObjectRecords.ts';
import type {
  BulkConflictMode,
  BulkCreateResult,
  BulkValidationMode,
} from '../../queries';

/** What a failed request said, or `fallback`. */
function failureMessage(error: unknown, fallback: string): string {
  const failure = error as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    failure?.response?.data?.error ||
    failure?.response?.data?.message ||
    failure?.message ||
    fallback
  );
}

/**
 * Acting on many records at once: deleting or editing the selected ones, and
 * inserting a batch. Each has a dialog, whose open state is here too.
 */
export function useBulkActions({
  schemaId,
  connectionId,
  selectedIds,
  clearSelection,
  discardRows,
}: {
  schemaId: string;
  connectionId?: string | null;
  selectedIds: string[];
  clearSelection: () => void;
  /** Gives up the rows' unsaved edits and drafts (see useRowEdits). */
  discardRows: (rowIds: string[]) => {
    recordIds: string[];
    restore: () => void;
  };
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const bulkDeleteMutation = useBulkDeleteObjectInstances(connectionId);
  const bulkUpdateMutation = useBulkUpdateObjectInstances(connectionId);
  const bulkCreateMutation = useBulkCreateObjectInstances(connectionId);

  const insert = useCallback(
    async (
      instances: unknown[],
      onConflict: BulkConflictMode,
      onError: BulkValidationMode,
      conflictColumns: string[]
    ): Promise<BulkCreateResult | undefined> => {
      try {
        const result = await bulkCreateMutation.mutateAsync({
          schemaId,
          instances,
          options: { onConflict, onError, conflictColumns },
        });
        if (result.errors.length === 0) {
          toast.success(
            `Inserted ${result.createdCount}, skipped ${result.skippedCount}`
          );
        } else {
          toast.warning(
            `Inserted ${result.createdCount}, skipped ${result.skippedCount} (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`
          );
        }
        return result;
      } catch (error) {
        toast.error('Unable to insert records', {
          description: failureMessage(error, 'Failed to insert records'),
        });
        return undefined;
      }
    },
    [bulkCreateMutation, schemaId]
  );

  const deleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;

    const { recordIds, restore } = discardRows(selectedIds);
    if (recordIds.length === 0) {
      clearSelection();
      setDeleteOpen(false);
      return;
    }

    try {
      await bulkDeleteMutation.mutateAsync({
        schemaId,
        instanceIds: recordIds,
      });
      clearSelection();
      setDeleteOpen(false);
    } catch (error) {
      restore();
      const failure = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      toast.error('Unable to delete selected records', {
        description:
          failure?.response?.data?.message ||
          failure?.message ||
          'Failed to delete records',
      });
    }
  }, [bulkDeleteMutation, schemaId, selectedIds, discardRows, clearSelection]);

  const editSelected = useCallback(
    async (properties: Record<string, unknown>) => {
      if (selectedIds.length === 0 || Object.keys(properties).length === 0) {
        return;
      }
      try {
        const updated = await bulkUpdateMutation.mutateAsync({
          schemaId,
          instanceIds: selectedIds,
          properties,
        });
        toast.success(`Updated ${updated} record${updated === 1 ? '' : 's'}`);
        clearSelection();
        setEditOpen(false);
      } catch (error) {
        toast.error('Unable to update selected records', {
          description: failureMessage(error, 'Failed to update records'),
        });
      }
    },
    [bulkUpdateMutation, schemaId, selectedIds, clearSelection]
  );

  return {
    deleteOpen,
    setDeleteOpen,
    deleteSelected,
    editOpen,
    setEditOpen,
    editSelected,
    isEditing: bulkUpdateMutation.isPending,
    insertOpen,
    setInsertOpen,
    insert,
    isInserting: bulkCreateMutation.isPending,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { Instance } from '@/generated/RuntaraRuntimeApi';
import {
  useCreateObjectInstanceDto,
  useUpdateObjectInstanceDto,
} from '@/features/objects/hooks/useObjectRecords.ts';
import { isNotFoundError } from '@/shared/hooks/api';
import { useWarnBeforeUnload } from '@/shared/hooks/useWarnBeforeUnload';
import { clickLandedInGrid } from './click-target';
import {
  DRAFT_ID_PREFIX,
  isDraftRow,
  makeDraftInstance,
  splitDraftIds,
} from './draft-row';
import {
  dropEditsForRows,
  isUnchangedFailure,
  recordCellEdit,
  restoreEditsForRows,
  settleCreatedDraft,
  settleSavedRow,
  withSaveFailed,
} from './pending-edits';
import { createRowSaveQueue } from './row-save-queue';

/**
 * Editing records in place: the cells changed and not yet saved, the draft
 * rows not yet created, and when each row is written. A row is saved when the
 * user leaves it (another row, a click outside the grid, the page), one
 * request per row at a time.
 */
export function useRowEdits({
  schemaId,
  connectionId,
  serverRecords,
}: {
  schemaId: string;
  connectionId?: string | null;
  /** The page of records the server holds. */
  serverRecords: Instance[] | undefined;
}) {
  const [pendingRecords, setPendingRecords] = useState<Instance[]>([]);
  const [animatingRowId, setAnimatingRowId] = useState<string | null>(null);
  // Rows whose last save failed: marked until a save succeeds (OB-3).
  const [failedRowIds, setFailedRowIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const markSaveFailed = useCallback((rowId: string, failed: boolean) => {
    setFailedRowIds((prev) => withSaveFailed(prev, rowId, failed));
  }, []);

  // Track which row has unsaved changes
  const [dirtyRows, setDirtyRows] = useState<Map<string, any>>(new Map());
  const lastFocusedRowRef = useRef<string | null>(null);

  // Track which cell is currently being edited (rowId-columnId)
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const editingCellIdRef = useRef<string | null>(null);

  useEffect(() => {
    editingCellIdRef.current = editingCellId;
  }, [editingCellId]);

  // What the server holds, for telling an edit from a revert.
  const serverRecordsRef = useRef<Instance[]>([]);
  serverRecordsRef.current = serverRecords ?? [];

  const records = useMemo(() => {
    const withEdits = (record: Instance) => {
      const dirtyData = dirtyRows.get(record.id || '');
      return dirtyData
        ? { ...record, properties: { ...record.properties, ...dirtyData } }
        : record;
    };
    // The server's records, then the drafts, each with its unsaved cells.
    return [
      ...(serverRecords ?? []).map(withEdits),
      ...pendingRecords.map(withEdits),
    ];
  }, [serverRecords, pendingRecords, dirtyRows]);

  // A deferred flush can lose the race with a delete and 404; that case is
  // handled in saveDirtyRow, so the shared 404 toast stays off.
  const { mutateAsync: updateRecord } = useUpdateObjectInstanceDto(
    connectionId,
    {
      suppressNotFoundToasts: true,
    }
  );
  const { mutateAsync: createRecord } =
    useCreateObjectInstanceDto(connectionId);

  const handleRowAnimationTrigger = useCallback((rowId: string) => {
    setAnimatingRowId(rowId);
    setTimeout(() => {
      setAnimatingRowId(null);
    }, 1000);
  }, []);

  const dirtyRowsRef = useRef(dirtyRows);

  useEffect(() => {
    dirtyRowsRef.current = dirtyRows;
  }, [dirtyRows]);

  // One save per row at a time; a flush during one runs after it (OB-1).
  const saveQueueRef = useRef(createRowSaveQueue());
  const saveDirtyRowRef = useRef<(rowId: string) => Promise<void>>();

  /** Sends one row's values; resolves to where they now live, or null. */
  const saveRow = useCallback(
    async (
      rowId: string,
      dirtyData: Record<string, unknown>
    ): Promise<string | null> => {
      if (isDraftRow(rowId)) {
        // Save pending record
        try {
          const newInstance = await createRecord({
            schemaId: schemaId,
            data: {
              properties: dirtyData,
              schemaId: schemaId,
            },
          });
          setPendingRecords((prev) => prev.filter((r) => r.id !== rowId));
          // Values typed while the POST was in flight move to the record.
          setDirtyRows((prev) => {
            const updated = settleCreatedDraft(
              prev,
              rowId,
              newInstance.id,
              dirtyData
            );
            dirtyRowsRef.current = updated;
            return updated;
          });
          if (newInstance.id && lastFocusedRowRef.current === rowId) {
            lastFocusedRowRef.current = newInstance.id;
          }
          // Trigger animation with the server-returned ID
          if (newInstance.id) {
            handleRowAnimationTrigger(newInstance.id);
          }
          markSaveFailed(rowId, false);
          return newInstance.id ?? null;
        } catch {
          markSaveFailed(rowId, true);
          toast.error('Failed to create record');
          return null;
        }
      } else {
        // Save existing record
        try {
          await updateRecord({
            schemaId: schemaId,
            instanceId: rowId,
            data: {
              properties: dirtyData,
            },
          });
          // Only what this request sent is saved: a value typed while it was
          // in flight stays dirty for the next flush.
          setDirtyRows((prev) => {
            const updated = settleSavedRow(prev, rowId, dirtyData);
            dirtyRowsRef.current = updated;
            return updated;
          });
          markSaveFailed(rowId, false);
          handleRowAnimationTrigger(rowId);
          return rowId;
        } catch (error) {
          if (isNotFoundError(error)) {
            // The row was deleted while this edit was pending. Its
            // disappearance is already visible, so drop the edit rather than
            // announce a failure — and clear it so nothing retries the write.
            setDirtyRows((prev) => {
              const updated = new Map(prev);
              updated.delete(rowId);
              dirtyRowsRef.current = updated;
              return updated;
            });
            return null;
          }
          markSaveFailed(rowId, true);
          toast.error('Failed to update record');
          return null;
        }
      }
    },
    [
      createRecord,
      updateRecord,
      schemaId,
      handleRowAnimationTrigger,
      markSaveFailed,
    ]
  );

  // The values each row last failed to save. A flush does not send them again
  // unless they changed: every click away used to repeat the rejected request
  // (OB-4). A new edit makes a new object, so it does go out.
  const failedValuesRef = useRef(new Map<string, Record<string, unknown>>());

  const saveDirtyRow = useCallback(
    async (rowId: string) => {
      const dirtyData = dirtyRowsRef.current.get(rowId);
      if (
        !dirtyData ||
        isUnchangedFailure(failedValuesRef.current, rowId, dirtyData) ||
        !saveQueueRef.current.begin(rowId)
      ) {
        return;
      }
      let savedRowId: string | null = null;
      try {
        savedRowId = await saveRow(rowId, dirtyData);
        if (savedRowId) failedValuesRef.current.delete(rowId);
        else failedValuesRef.current.set(rowId, dirtyData);
      } finally {
        // A flush that waited runs once the state updates above have landed,
        // and sends only what changed meanwhile; against the record's id if a
        // draft was created. Not after a failure: a failed row is not re-sent.
        if (saveQueueRef.current.end(rowId) && savedRowId) {
          const next = savedRowId;
          setTimeout(() => void saveDirtyRowRef.current?.(next), 0);
        }
      }
    },
    [saveRow]
  );
  saveDirtyRowRef.current = saveDirtyRow;

  // Leaving with unsaved rows (OB-12). A reload or a closed tab warns; an
  // in-app move with no click away (back or forward) used to drop the edits
  // silently, so leaving the table saves them, as a clicked link already did.
  const hasDirtyRows = dirtyRows.size > 0;
  useWarnBeforeUnload(hasDirtyRows);
  useEffect(
    () => () => {
      for (const rowId of dirtyRowsRef.current.keys()) {
        void saveDirtyRowRef.current?.(rowId);
      }
    },
    []
  );

  const handleUpdate = useCallback((instanceId: string, data: any) => {
    const propertyEntries = Object.entries(data.properties || {});
    const hasChanges = propertyEntries.length > 0;

    if (isDraftRow(instanceId)) {
      // Update pending record immediately in state
      setPendingRecords((prev) => {
        let didUpdate = false;
        const next = prev.map((rec) => {
          if (rec.id !== instanceId) return rec;
          const nextProps = { ...rec.properties };
          propertyEntries.forEach(([key, value]) => {
            if (nextProps[key] !== value) {
              didUpdate = true;
              nextProps[key] = value;
            }
          });
          return didUpdate
            ? {
                ...rec,
                properties: nextProps,
              }
            : rec;
        });
        return didUpdate ? next : prev;
      });
    }

    if (hasChanges) {
      const serverProperties = isDraftRow(instanceId)
        ? undefined
        : serverRecordsRef.current.find((r) => r.id === instanceId)?.properties;
      setDirtyRows((prev) => {
        const updated = recordCellEdit(
          prev,
          instanceId,
          data.properties,
          serverProperties as Record<string, unknown> | undefined
        );
        // Update ref immediately so saveDirtyRow can see it
        dirtyRowsRef.current = updated;
        return updated;
      });
    }
  }, []);

  // Save when clicking away from the grid
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!lastFocusedRowRef.current) return;

      if (!clickLandedInGrid(e.target as Node | null, tableRef.current)) {
        // Capture ref value before the async delay
        const rowId = lastFocusedRowRef.current;
        // Small delay to let any pending handleSave complete
        setTimeout(() => {
          if (rowId) saveDirtyRow(rowId);
        }, 100);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [saveDirtyRow]);

  const handleAddRow = useCallback(() => {
    // Save current row before adding new one
    if (lastFocusedRowRef.current) {
      saveDirtyRow(lastFocusedRowRef.current);
    }

    const newId = `${DRAFT_ID_PREFIX}${Date.now()}`;
    setPendingRecords((prev) => [...prev, makeDraftInstance(newId)]);
  }, [saveDirtyRow]);

  const handleCellFocus = useCallback(
    (rowId: string) => {
      // If switching to a different row, save the previous row first
      if (lastFocusedRowRef.current && lastFocusedRowRef.current !== rowId) {
        saveDirtyRow(lastFocusedRowRef.current);
      }

      lastFocusedRowRef.current = rowId;
    },
    [saveDirtyRow]
  );

  // `handleUpdate` only records the edit; the write happens here. Deferring by
  // a tick lets that state update land first, the same way the click-away
  // handler waits before flushing.
  const commitRow = useCallback(
    (rowId: string) => {
      setTimeout(() => saveDirtyRow(rowId), 0);
    },
    [saveDirtyRow]
  );

  /**
   * Gives up the unsaved edits of rows about to be deleted, and the drafts
   * among them. Returns the records left to delete on the server, and how to
   * bring their edits back if that fails.
   */
  const discardRows = useCallback((rowIds: string[]) => {
    // Confirming the delete makes unsaved inline edits to these rows moot.
    // Drop them before the request goes out: flushes are deferred behind
    // timeouts, so one can still be queued right now, and it must find
    // nothing to write rather than target a row that is about to vanish.
    const beforeDelete = {
      dirtyRows: dirtyRowsRef.current,
      lastFocusedRowId: lastFocusedRowRef.current,
      editingCellId: editingCellIdRef.current,
    };
    const pruned = dropEditsForRows(beforeDelete, rowIds);
    dirtyRowsRef.current = pruned.dirtyRows;
    setDirtyRows(pruned.dirtyRows);
    lastFocusedRowRef.current = pruned.lastFocusedRowId;
    setEditingCellId(pruned.editingCellId);

    // Drafts exist only here: discard them, and send the server only records
    // (OB-6). This is also how a draft is discarded at all (OB-7).
    const { recordIds, draftIds } = splitDraftIds(rowIds);
    if (draftIds.length > 0) {
      setPendingRecords((prev) =>
        prev.filter((r) => !draftIds.includes(r.id ?? ''))
      );
    }

    return {
      recordIds,
      /** The records survived, so their unsaved edits are live again (OB-5). */
      restore: () => {
        const restored = restoreEditsForRows(
          {
            dirtyRows: dirtyRowsRef.current,
            lastFocusedRowId: lastFocusedRowRef.current,
          },
          beforeDelete,
          recordIds
        );
        dirtyRowsRef.current = restored.dirtyRows;
        setDirtyRows(restored.dirtyRows);
        lastFocusedRowRef.current = restored.lastFocusedRowId;
      },
    };
  }, []);

  const editingCell = useMemo(
    () => ({ editingCellId, setEditingCellId }),
    [editingCellId]
  );

  return {
    /** The rows to draw: records and drafts, with their unsaved cells. */
    records,
    draftCount: pendingRecords.length,
    failedRowIds,
    animatingRowId,
    editingCell,
    /** The grid's element: a click outside it saves the row being edited. */
    tableRef,
    handleUpdate,
    handleCellFocus,
    commitRow,
    handleAddRow,
    discardRows,
  };
}

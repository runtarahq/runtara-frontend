import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Can } from '@/shared/components/Can';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/shared/components/table';
import { computeRecordTotals } from './draft-row';
import {
  Breadcrumb,
  ConsoleTableShell,
  ConsoleToolbar,
  FilterPopover,
  SelectionActionBar,
  TablePagination,
  TableStatusFooter,
} from '@/shared/components/console';
import { Schema } from '@/generated/RuntaraRuntimeApi';
import { useObjectInstanceDtos } from '@/features/objects/hooks/useObjectRecords.ts';
import { objectInstancesColumns } from './ObjectInstancesColumns';
import { EditingCellContext } from './editing-cell-context';
import { FilterComposer } from '../FilterComposer';
import { ImportCsvDialog } from '../ImportCsvDialog';
import { AddRowButton } from './AddRowButton';
import { BulkDeleteDialog } from './BulkDeleteDialog';
import { BulkEditDialog } from './BulkEditDialog';
import { BulkInsertDialog } from './BulkInsertDialog';
import { RecordsToolbarActions } from './RecordsToolbarActions';
import { filterSchemaDefinition } from './filter-schema';
import { useBulkActions } from './use-bulk-actions';
import { useRecordsExport } from './use-records-export';
import { useRecordsView } from './use-records-view';
import { useRowEdits } from './use-row-edits';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';

interface ObjectInstanceDtosTableProps {
  objectSchemaDto: Schema;
  connectionId?: string | null;
}

// The records of an object type, edited in place. The table is assembled
// here from its parts: which records are shown (use-records-view), editing
// them in place (use-row-edits), acting on many (use-bulk-actions) and
// exporting them (use-records-export).
export function ObjectInstanceDtosTable({
  objectSchemaDto,
  connectionId,
}: ObjectInstanceDtosTableProps) {
  const schemaId = objectSchemaDto.id || '';
  const view = useRecordsView();
  const { filterCondition, page, pageSize, sortBy, sortOrder } = view;

  // Check if schema has a name for filtering/sorting
  const hasFilteringOrSorting = filterCondition || sortBy || sortOrder;
  const isMissingSchemaName = !objectSchemaDto.name && hasFilteringOrSorting;

  const { data, isLoading, isError, error } = useObjectInstanceDtos(
    objectSchemaDto.id,
    objectSchemaDto.name || undefined,
    connectionId,
    filterCondition,
    page,
    pageSize,
    sortBy,
    sortOrder
  );

  // Display error toast when query fails
  useEffect(() => {
    if (isError && error) {
      const errorMessage =
        (error as any)?.message || 'Failed to fetch records. Please try again.';
      toast.error(errorMessage);
    }
  }, [isError, error]);

  // Totals come from the server page alone; draft rows must not count.
  const { totalPages, totalElements } = computeRecordTotals(data, pageSize);

  const edits = useRowEdits({
    schemaId,
    connectionId,
    serverRecords: data?.content,
  });
  const bulk = useBulkActions({
    schemaId,
    connectionId,
    selectedIds: view.selectedIds,
    clearSelection: view.clearSelection,
    discardRows: edits.discardRows,
  });
  const { exportCsv, isExporting } = useRecordsExport({
    schemaName: objectSchemaDto.name,
    connectionId,
    filterCondition,
    sortBy,
    sortOrder,
  });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const selectedCount = view.selectedIds.length;

  const { handleUpdate, handleCellFocus, commitRow } = edits;
  const columns = useMemo(
    () =>
      objectInstancesColumns({
        objectSchemaDto,
        onUpdate: handleUpdate,
        enableSelection: true,
        onCellFocus: handleCellFocus,
        onCommitRow: commitRow,
      }),
    [objectSchemaDto, handleUpdate, handleCellFocus, commitRow]
  );

  const filterSchema = useMemo(
    () => filterSchemaDefinition(objectSchemaDto.columns),
    [objectSchemaDto.columns]
  );

  const { rowSelection } = view;
  const { setDeleteOpen } = bulk;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        Object.keys(rowSelection).length > 0
      ) {
        if (
          document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA'
        ) {
          return;
        }
        setDeleteOpen(true);
      }
    },
    [rowSelection, setDeleteOpen]
  );

  return (
    <EditingCellContext.Provider value={edits.editingCell}>
      <ConsoleTableShell
        ref={edits.tableRef}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="outline-none"
        toolbar={
          <>
            <ConsoleToolbar
              left={
                <Breadcrumb
                  items={[
                    { label: 'Objects', to: '/objects/types' },
                    { label: objectSchemaDto.name ?? 'Records' },
                  ]}
                />
              }
              filter={
                <FilterPopover
                  title="Filter records"
                  activeCount={filterCondition ? 1 : 0}
                  onClear={() => view.changeFilter(null)}
                  contentClassName="w-[480px]"
                >
                  <FilterComposer
                    value={filterCondition}
                    onChange={view.changeFilter}
                    schemaDefinition={filterSchema}
                  />
                </FilterPopover>
              }
              actions={
                <RecordsToolbarActions
                  canTransfer={Boolean(objectSchemaDto.name)}
                  isExporting={isExporting}
                  onExport={exportCsv}
                  onImport={() => setShowImportDialog(true)}
                  onBulkInsert={() => bulk.setInsertOpen(true)}
                />
              }
            />
            {isMissingSchemaName && (
              <Alert variant="destructive" className="m-3">
                <AlertDescription>
                  This schema does not have a name defined. Filtering and
                  sorting are not available. Please contact your administrator
                  to add a name to this schema.
                </AlertDescription>
              </Alert>
            )}
          </>
        }
        selectionBar={
          <SelectionActionBar
            count={selectedCount}
            onClear={view.clearSelection}
          >
            <Can permission="database:update">
              <Button
                variant="secondary"
                bordered
                size="sm"
                onClick={() => bulk.setEditOpen(true)}
              >
                <Pencil className="mr-2 size-4" />
                Edit
              </Button>
            </Can>
            <Can permission="database:delete">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => bulk.setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </Button>
            </Can>
          </SelectionActionBar>
        }
        footer={
          <TableStatusFooter
            left={`${totalElements.toLocaleString()} record${
              totalElements === 1 ? '' : 's'
            }${
              edits.draftCount > 0
                ? ` (+${edits.draftCount} draft${
                    edits.draftCount === 1 ? '' : 's'
                  })`
                : ''
            }`}
            right={
              <TablePagination
                pageIndex={page}
                pageSize={pageSize}
                pageCount={totalPages}
                onPageChange={view.changePage}
                onPageSizeChange={view.changePageSize}
              />
            }
          />
        }
      >
        <DataTable
          columns={columns}
          data={edits.records}
          isFetching={isLoading}
          shouldRenderPagination={false}
          stickyHeader
          pagination={{
            pageIndex: page,
            pageSize: pageSize,
            pageCount: totalPages,
            totalCount: totalElements,
            onPageChange: view.changePage,
            onPageSizeChange: view.changePageSize,
          }}
          sorting={view.sorting}
          onSortingChange={view.changeSorting}
          manualSorting={true}
          enableRowSelection={true}
          rowSelection={rowSelection}
          onRowSelectionChange={view.setRowSelection}
          getRowId={(row) => row.id || ''}
          getRowClassName={(row) =>
            cn(
              row.original.id === edits.animatingRowId && 'animate-row-flash',
              // Not saved: the server rejected this row's last change.
              edits.failedRowIds.has(row.original.id ?? '') &&
                'bg-destructive/10'
            )
          }
          beforePaginationSlot={
            <Can permission="database:create">
              <AddRowButton onClick={edits.handleAddRow} />
            </Can>
          }
        />
      </ConsoleTableShell>

      <BulkEditDialog
        open={bulk.editOpen}
        onOpenChange={bulk.setEditOpen}
        selectedCount={selectedCount}
        schema={objectSchemaDto}
        onSubmit={bulk.editSelected}
        isSubmitting={bulk.isEditing}
      />

      <BulkInsertDialog
        open={bulk.insertOpen}
        onOpenChange={bulk.setInsertOpen}
        schema={objectSchemaDto}
        onSubmit={bulk.insert}
        isSubmitting={bulk.isInserting}
      />

      <BulkDeleteDialog
        open={bulk.deleteOpen}
        onOpenChange={bulk.setDeleteOpen}
        selectedCount={selectedCount}
        onConfirm={bulk.deleteSelected}
      />

      <ImportCsvDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        objectSchemaDto={objectSchemaDto}
        connectionId={connectionId}
      />
    </EditingCellContext.Provider>
  );
}

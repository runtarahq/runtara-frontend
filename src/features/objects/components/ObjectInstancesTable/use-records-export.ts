import { useCallback } from 'react';
import { toast } from 'sonner';

import type { Condition } from '@/generated/RuntaraRuntimeApi';
import { useExportCsv } from '@/features/objects/hooks/useObjectRecords.ts';

/** Downloads the records the table is showing, all pages of them, as CSV. */
export function useRecordsExport({
  schemaName,
  connectionId,
  filterCondition,
  sortBy,
  sortOrder,
}: {
  schemaName: string | null | undefined;
  connectionId?: string | null;
  filterCondition: Condition | null;
  sortBy: string[] | undefined;
  sortOrder: string[] | undefined;
}) {
  const exportCsvMutation = useExportCsv(connectionId);

  const exportCsv = useCallback(async () => {
    if (!schemaName) {
      toast.error('Schema name is required for export');
      return;
    }

    try {
      const blob = await exportCsvMutation.mutateAsync({
        schemaName,
        data: {
          condition: filterCondition || undefined,
          sortBy,
          sortOrder,
          includeSystemColumns: true,
        },
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${schemaName}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV exported successfully');
    } catch {
      // Error toast handled by useCustomMutation
    }
  }, [schemaName, filterCondition, sortBy, sortOrder, exportCsvMutation]);

  return { exportCsv, isExporting: exportCsvMutation.isPending };
}

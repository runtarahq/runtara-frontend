import { Download, Plus, Upload } from 'lucide-react';

import { Can } from '@/shared/components/Can';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import { ObjectModelConnectionSelector } from '../ObjectModelConnectionSelector';

/** The toolbar's right side: the connection, and getting records in and out. */
export function RecordsToolbarActions({
  canTransfer,
  isExporting,
  onExport,
  onImport,
  onBulkInsert,
}: {
  /** A type without a name can be neither exported nor imported into. */
  canTransfer: boolean;
  isExporting: boolean;
  onExport: () => void;
  onImport: () => void;
  onBulkInsert: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ObjectModelConnectionSelector />
      {canTransfer && (
        <>
          <Button
            variant="secondary"
            bordered
            size="sm"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            Export
          </Button>
          <Can permission="database:create">
            <Button variant="secondary" bordered size="sm" onClick={onImport}>
              <Upload className="mr-2 size-4" />
              Import
            </Button>
            <Button
              variant="secondary"
              bordered
              size="sm"
              onClick={onBulkInsert}
            >
              <Plus className="mr-2 size-4" />
              Bulk insert
            </Button>
          </Can>
        </>
      )}
    </div>
  );
}

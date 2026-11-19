import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { Copy } from 'lucide-react';
import {
  OperationViewConfig,
  WorkflowInstanceDto,
} from '@/generated/RuntaraRuntimeApi';
import { cn } from '@/lib/utils';
import { RunStatusPill } from '@/features/runs/components/RunLinks';
import { formatRunDuration } from '@/features/runs/utils/run-duration';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  StateValue,
  type StateField,
} from '@/features/runs/components/StateValue';
import { stateLabel } from '@/features/runs/utils/state-label';

export function OperationHeader({
  title,
  description,
  actions,
  section,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  section?: string;
}) {
  return (
    <header className="mb-5">
      <nav
        aria-label="Breadcrumb"
        className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Link to="/operations" className="hover:text-foreground">
          Operations
        </Link>
        {section ? (
          <>
            <span>/</span>
            <Link
              to={
                section === 'Queues' ? '/operations/queues' : '/operations/runs'
              }
            >
              {section}
            </Link>
          </>
        ) : null}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {description ? (
            <div className="mt-2 text-sm text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
    </header>
  );
}
export function OperationSection({
  title,
  aside,
  children,
  className = '',
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-lg border bg-background ${className}`}
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="text-xs text-muted-foreground">{aside}</div>
      </div>
      {children}
    </section>
  );
}
export function RunRows({
  rows,
  view,
  schema = {},
  showDuration = false,
}: {
  rows: WorkflowInstanceDto[];
  view?: OperationViewConfig;
  schema?: Record<string, StateField>;
  /** Add a Duration column after Started. */
  showDuration?: boolean;
}) {
  // Inside a bordered panel the console table's page-edge inset is too deep.
  const edge = 'md:first:pl-5 md:last:pr-5';
  return (
    <div className="overflow-x-auto">
      <Table variant="console">
        <TableHeader>
          <TableRow>
            <TableHead className={edge}>Run</TableHead>
            <TableHead className={edge}>Workflow</TableHead>
            <TableHead className={edge}>Status</TableHead>
            {view?.columns?.map((field) => (
              <TableHead className={edge} key={field}>
                {view.labels?.[field] || stateLabel(field, schema[field])}
              </TableHead>
            ))}
            <TableHead className={edge}>Started</TableHead>
            {showDuration ? (
              <TableHead className={edge}>Duration</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((run) => {
            const label =
              (view?.roles?.key && run.state?.[view.roles.key]) ?? run.runLabel;
            return (
              <TableRow key={run.id}>
                <TableCell className={edge}>
                  <div className="flex items-center gap-2">
                    <Link
                      className={cn(
                        'whitespace-nowrap font-medium text-primary-text hover:underline',
                        label == null && 'font-mono text-[13px]'
                      )}
                      to={`/operations/runs/${run.workflowId}/${run.id}`}
                    >
                      {String(label ?? run.id.slice(0, 8))}
                    </Link>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Copy run ID ${run.id}`}
                      title={run.id}
                      onClick={() => void navigator.clipboard.writeText(run.id)}
                    >
                      <Copy className="size-3" />
                    </button>
                  </div>
                </TableCell>
                <TableCell
                  className={cn('min-w-44 text-muted-foreground', edge)}
                >
                  {run.workflowName ?? run.workflowId}
                </TableCell>
                <TableCell className={cn('whitespace-nowrap', edge)}>
                  <RunStatusPill
                    status={run.status}
                    suspensionReason={run.suspensionReason}
                  />
                </TableCell>
                {view?.columns?.map((field) => (
                  <TableCell className={cn('max-w-xs', edge)} key={field}>
                    <StateValue
                      value={run.state?.[field]}
                      field={schema[field]}
                      display={view.formats?.[field]}
                    />
                  </TableCell>
                ))}
                <TableCell
                  className={cn(
                    'whitespace-nowrap tabular-nums text-muted-foreground',
                    edge
                  )}
                >
                  <StateValue
                    value={run.created}
                    display={{ kind: 'relative' }}
                  />
                </TableCell>
                {showDuration ? (
                  <TableCell
                    className={cn('whitespace-nowrap tabular-nums', edge)}
                  >
                    {formatRunDuration(run.executionDurationSeconds)}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

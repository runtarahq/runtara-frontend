import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  OperationRequest,
  OperationViewConfig,
} from '@/generated/RuntaraRuntimeApi';
import { requestKey } from '@/features/operations/utils/queue-view';
import { QueueBulkBar } from './QueueBulkBar';
import { QueueRequestsTable } from './QueueRequestsTable';
import { QueueToolbar } from './QueueToolbar';

vi.mock('@/shared/components/Can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./QueueAnswer', () => ({
  QueueAnswer: ({ row }: { row: OperationRequest }) => (
    <span>answer for {row.requestId}</span>
  ),
}));

const schema = { total: { type: 'number' }, region: { type: 'string' } };

describe('QueueToolbar', () => {
  const props = {
    isQueue: true,
    tabs: [
      { key: 'open' as const, label: 'Open', count: 12 },
      { key: 'overdue' as const, label: 'Overdue', count: 3 },
    ],
    activeTab: 'open' as const,
    onTab: vi.fn(),
    search: '',
    onSearch: vi.fn(),
    filtersOpen: false,
    filterCount: 2,
    onToggleFilters: vi.fn(),
    sort: undefined,
    onSort: vi.fn(),
    schema,
  };

  it('offers a queue its tabs with their counts, the search and the filters', () => {
    render(<QueueToolbar {...props} />);

    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.click(screen.getByRole('tab', { name: /Overdue\s*3/ }));
    expect(props.onTab).toHaveBeenCalledWith('overdue');

    fireEvent.change(screen.getByLabelText('Search runs'), {
      target: { value: 'acme' },
    });
    expect(props.onSearch).toHaveBeenCalledWith('acme');

    fireEvent.click(screen.getByRole('button', { name: /Filters \(2\)/ }));
    expect(props.onToggleFilters).toHaveBeenCalled();
    expect(screen.queryByLabelText('Sort by')).not.toBeInTheDocument();
  });

  it('offers a view of runs their count and a sort whose button flips its direction', () => {
    const onSort = vi.fn();
    render(
      <QueueToolbar
        {...props}
        isQueue={false}
        total={1}
        sort={{ field: 'total', descending: false }}
        onSort={onSort}
      />
    );

    expect(screen.getByText('run')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(onSort).toHaveBeenCalledWith({ field: 'total', descending: true });

    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: '' },
    });
    expect(onSort).toHaveBeenLastCalledWith(null);
  });
});

describe('QueueBulkBar', () => {
  it('gives the selected requests a common answer, submits or clears them', () => {
    const onChoose = vi.fn();
    const onSubmit = vi.fn();
    const onClear = vi.fn();
    render(
      <QueueBulkBar
        count={2}
        common={['approve']}
        onChoose={onChoose}
        onSubmit={onSubmit}
        onClear={onClear}
      />
    );

    expect(screen.getByText('2 requests selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /selected$/ }));
    expect(onChoose).toHaveBeenCalledWith('approve');
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit prepared answers' })
    );
    expect(onSubmit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('QueueRequestsTable', () => {
  const rows = [
    {
      instanceId: 'i1',
      requestId: 'q1',
      workflowId: 'wf',
      label: 'Approve order?',
      runLabel: 'Order 1',
      requestedAt: '2026-09-29T10:00:00Z',
      state: { total: 10, region: 'EU' },
      context: { region: 'EU', note: 'rush' },
    },
    {
      instanceId: 'i2',
      requestId: 'q2',
      workflowId: 'wf',
      label: 'Approve order?',
      runLabel: 'Order 2',
      requestedAt: '2026-09-29T11:00:00Z',
      state: { total: 20, region: 'US' },
    },
  ] as unknown as OperationRequest[];
  const view = {
    name: 'Approvals',
    workflow: 'wf',
    columns: ['total', 'region'],
    roles: {},
    sort: { field: 'total', descending: true },
  } as unknown as OperationViewConfig;

  const table = (
    overrides: Partial<Parameters<typeof QueueRequestsTable>[0]>
  ) =>
    render(
      <MemoryRouter>
        <QueueRequestsTable
          rows={rows}
          view={view}
          schema={schema}
          bulk
          inferAnswers
          selection={new Set()}
          onSelectionChange={vi.fn()}
          onSort={vi.fn()}
          onAnswerController={vi.fn()}
          {...overrides}
        />
      </MemoryRouter>
    );

  it('draws a row per request, the question once, and context its columns do not show', () => {
    table({});

    expect(
      screen.getByRole('columnheader', { name: 'Approve order?' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Order 1' })).toHaveAttribute(
      'href',
      '/operations/runs/wf/i1'
    );
    expect(screen.getByText('answer for q2')).toBeInTheDocument();
    // `region` is a column, so only `note` is listed as context.
    expect(screen.getByText('rush')).toBeInTheDocument();
    expect(screen.getAllByText('EU')).toHaveLength(1);
  });

  it('marks the sorted column and asks for a sort by the one clicked', () => {
    const onSort = vi.fn();
    table({ onSort });

    const sorted = screen.getByRole('columnheader', { name: /total/i });
    expect(sorted).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /region/i })).getByRole(
        'button'
      )
    );
    expect(onSort).toHaveBeenCalledWith('region');
  });

  it('selects one request, or the page', () => {
    const onSelectionChange = vi.fn();
    table({ onSelectionChange, selection: new Set([requestKey(rows[0])]) });

    fireEvent.click(screen.getByLabelText('Select Order 2 q2'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      new Set([requestKey(rows[0]), requestKey(rows[1])])
    );

    fireEvent.click(screen.getByLabelText('Select Order 1 q1'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set());

    fireEvent.click(screen.getByLabelText('Select page'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      new Set(rows.map(requestKey))
    );
  });

  it('offers no selection where requests cannot be answered together', () => {
    table({ bulk: false });

    expect(screen.queryByLabelText('Select page')).not.toBeInTheDocument();
  });
});

import type {
  OperationRequest,
  OperationViewConfig,
  StateFilterDto,
} from '@/generated/RuntaraRuntimeApi';
import { overdueFilters } from '@/features/operations/queries/attention-requests';
import type { StateField } from '@/features/runs/components/StateValue';

// What the queue page works out from a view and its rows, apart from drawing
// them.

/** A request's identity on the page: a run can ask more than once. */
export const requestKey = (request: OperationRequest) =>
  JSON.stringify([request.instanceId, request.requestId]);

export const isNumeric = (field?: StateField) =>
  field?.type === 'number' || field?.type === 'integer';

/** Overdue is a lens on the queue, applied per query and never saved. */
export function withOverdue(view: OperationViewConfig): OperationViewConfig {
  return {
    ...view,
    where: {
      ...view.where,
      state: [
        ...(view.where?.state ?? []),
        ...((overdueFilters(view, Date.now()) ?? []) as StateFilterDto[]),
      ],
    },
  };
}

/** A column header's click: ascending, descending, then the default order. */
export function cycleSort(
  sort: OperationViewConfig['sort'],
  field: string
): OperationViewConfig['sort'] {
  if (sort?.field !== field) return { field, descending: false };
  return sort.descending ? null : { field, descending: true };
}

/**
 * The answers every selected request accepts: what one click can give them
 * all. None when any of them offers no inline answers.
 */
export function commonAnswers(
  options: ({ values: unknown[] } | null | undefined)[]
): unknown[] {
  if (!options.length || !options.every(Boolean)) return [];
  return options[0]!.values.filter((value) =>
    options.every((option) =>
      option!.values.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(value)
      )
    )
  );
}

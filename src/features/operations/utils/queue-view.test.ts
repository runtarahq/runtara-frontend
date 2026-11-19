import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  OperationRequest,
  OperationViewConfig,
} from '@/generated/RuntaraRuntimeApi';
import {
  commonAnswers,
  cycleSort,
  isNumeric,
  requestKey,
  withOverdue,
} from './queue-view';

afterEach(() => vi.useRealTimers());

describe('requestKey', () => {
  it('tells two requests of one run apart', () => {
    const first = { instanceId: 'i1', requestId: 'a' } as OperationRequest;
    const second = { instanceId: 'i1', requestId: 'b' } as OperationRequest;

    expect(requestKey(first)).not.toBe(requestKey(second));
    expect(requestKey(first)).toBe(requestKey({ ...first }));
  });
});

describe('isNumeric', () => {
  it('is true of numbers and integers only', () => {
    expect(isNumeric({ type: 'number' })).toBe(true);
    expect(isNumeric({ type: 'integer' })).toBe(true);
    expect(isNumeric({ type: 'string' })).toBe(false);
    expect(isNumeric(undefined)).toBe(false);
  });
});

describe('cycleSort', () => {
  it('goes ascending, descending, then back to the default order', () => {
    const ascending = cycleSort(undefined, 'total');
    expect(ascending).toEqual({ field: 'total', descending: false });

    const descending = cycleSort(ascending, 'total');
    expect(descending).toEqual({ field: 'total', descending: true });

    expect(cycleSort(descending, 'total')).toBeNull();
  });

  it('starts ascending on another column', () => {
    expect(cycleSort({ field: 'total', descending: true }, 'due')).toEqual({
      field: 'due',
      descending: false,
    });
  });
});

describe('commonAnswers', () => {
  it('keeps the answers every selected request accepts', () => {
    expect(
      commonAnswers([
        { values: ['approve', 'reject', 'hold'] },
        { values: ['reject', 'approve'] },
      ])
    ).toEqual(['approve', 'reject']);
    expect(
      commonAnswers([{ values: [{ a: 1 }, true] }, { values: [{ a: 1 }] }])
    ).toEqual([{ a: 1 }]);
  });

  it('is empty with nothing selected or a request that offers none', () => {
    expect(commonAnswers([])).toEqual([]);
    expect(commonAnswers([{ values: ['approve'] }, null])).toEqual([]);
  });
});

describe('withOverdue', () => {
  const view = {
    name: 'Approvals',
    workflow: 'wf',
    roles: { due: 'dueAt' },
    where: { openRequest: 'approve', state: [{ field: 'region', op: 'eq' }] },
  } as unknown as OperationViewConfig;

  it('adds the overdue condition to the view’s own filters, on a copy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));

    const overdue = withOverdue(view);

    expect(overdue.where?.state?.[0]).toEqual({ field: 'region', op: 'eq' });
    expect(overdue.where?.state?.length).toBeGreaterThan(1);
    expect(JSON.stringify(overdue.where?.state?.slice(1))).toContain('dueAt');
    expect(overdue.where?.openRequest).toBe('approve');
    expect(view.where?.state).toHaveLength(1);
  });

  it('leaves a view with no due field as it is', () => {
    const plain = { ...view, roles: {} } as OperationViewConfig;
    expect(withOverdue(plain).where?.state).toEqual(view.where?.state);
  });
});

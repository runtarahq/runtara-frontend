import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OperationRequest,
  SavedOperationView,
} from '@/generated/RuntaraRuntimeApi';
import {
  attentionQueues,
  attentionRequest,
  byUrgency,
  queryInbox,
  type AttentionQueue,
} from './attention-requests';
const request = vi.hoisted(() => vi.fn());
vi.mock('./queries', async () => ({
  ...(await vi.importActual('./queries')),
  operationsRequest: request,
}));
const now = Date.parse('2026-09-29T12:00:00Z');
function scope(id: string, count: number, due?: string): AttentionQueue {
  return {
    queue: {
      workflowId: id,
      workflowName: id,
      actionKey: 'review',
      name: 'Review',
      count,
      stateSchema: {},
    },
    view: {
      name: id,
      workflow: id,
      roles: due ? { due } : {},
      where: {
        openRequest: 'review',
        state: [{ field: 'unrelated', op: 'eq', value: { ignored: true } }],
      },
    },
  };
}
function rows(id: string, count: number): OperationRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    actionKey: 'review',
    context: {},
    instanceId: id,
    workflowId: id,
    requestId: `${id}-${i}`,
    label: 'Review',
    requestedAt: '2026-09-29T10:00:00Z',
    usedVersion: 1,
  }));
}
beforeEach(() => {
  request.mockReset();
});
describe('request metric drilldowns', () => {
  it('merges every queue into one list and names the queues it could not show in full', async () => {
    const scopes = [scope('A', 3), scope('B', 250, 'dueAt')];
    request.mockImplementation(async (_token, _path, _method, body) => ({
      content: rows(body.workflowId, body.workflowId === 'A' ? 3 : 100),
      totalElements: body.workflowId === 'A' ? 3 : 250,
    }));
    const result = await queryInbox('', scopes, ' 4821 ', now);
    expect(result.requests).toHaveLength(103);
    expect(result.total).toBe(253);
    expect(result.truncated).toEqual([
      { queue: scopes[1].queue, total: 250, shown: 100 },
    ]);
    const [a, b] = request.mock.calls.map((call) => call[3].query);
    expect(a).toMatchObject({ size: 100, search: '4821', state: [] });
    expect(a.stateSort).toBeUndefined();
    // A queue with a due field sends its most urgent requests first.
    expect(b.stateSort).toEqual({ field: 'dueAt', descending: false });
  });
  it('fails visibly if any queue cannot be loaded, instead of showing a partial list', async () => {
    request.mockRejectedValue(new Error('Unavailable'));
    await expect(queryInbox('', [scope('A', 1)])).rejects.toThrow(
      'Unavailable'
    );
  });
  it('orders overdue first, then what must be acted on soonest, then the longest waiting', () => {
    const item = (
      id: string,
      requestedAt: string,
      due?: string,
      deadline?: string
    ) =>
      attentionRequest(
        {
          ...rows(id, 1)[0],
          requestedAt,
          deadline,
          state: due ? { dueAt: due } : {},
        },
        scope(id, 1, 'dueAt'),
        now
      );
    const list = [
      item('old', '2026-09-20T00:00:00Z'),
      item(
        'expiring',
        '2026-09-29T11:00:00Z',
        undefined,
        '2026-09-29T12:30:00Z'
      ),
      item('due-later', '2026-09-29T11:00:00Z', '2026-09-29T18:00:00Z'),
      item('overdue', '2026-09-29T11:00:00Z', '2026-09-29T09:00:00Z'),
      item('more-overdue', '2026-09-29T11:00:00Z', '2026-09-28T09:00:00Z'),
      item('newer', '2026-09-25T00:00:00Z'),
    ].sort(byUrgency);
    expect(list.map((entry) => entry.row.instanceId)).toEqual([
      'more-overdue',
      'overdue',
      'expiring',
      'due-later',
      'old',
      'newer',
    ]);
  });
  it('selects the same due-bearing view for Overview and its request list', () => {
    const queue = scope('A', 1).queue;
    const views = [
      {
        configuration: {
          name: 'Filtered',
          workflow: 'A',
          where: { openRequest: 'review' },
          roles: {},
        },
      },
      {
        configuration: {
          name: 'Due',
          workflow: 'A',
          where: { openRequest: 'review' },
          roles: { due: 'dueAt' },
        },
      },
    ] as SavedOperationView[];
    expect(attentionQueues([queue], views)[0].view.roles?.due).toBe('dueAt');
  });
});

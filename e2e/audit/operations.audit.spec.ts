import { expect, type Page, type Route } from '@playwright/test';
import { test, type MockApi } from '../fixtures';
import { api, json } from './helpers';

const WF = 'wf_ops';
const INST = 'inst_ops_0001';
const VIEW_ID = 'view_1';
const POLL = 10_000;

const envelope = (data: unknown) => ({ data, success: true });

/** A response held open until the test releases it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function queue(count: number) {
  return {
    actionKey: 'review',
    count,
    name: 'Review',
    stateSchema: { amount: { type: 'number' }, due: { type: 'string' } },
    workflowId: WF,
    workflowName: 'Orders',
  };
}

function savedView(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEW_ID,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    configuration: {
      name: 'Saved queue',
      workflow: WF,
      columns: [],
      where: { openRequest: 'review', state: [] },
      roles: {},
      answers: { bulk: true, inline: 'decision' },
      formats: {},
      labels: {},
      ...overrides,
    },
  };
}

const decisionSchema = {
  decision: { type: 'string', enum: ['approve', 'reject'], required: true },
};

function request(
  id: string,
  inputSchema: Record<string, unknown> = decisionSchema
) {
  return {
    actionKey: 'review',
    context: null,
    inputSchema,
    instanceId: `inst_${id}`,
    label: 'Approve order?',
    requestId: `req_${id}`,
    requestedAt: '2026-01-01T00:00:00Z',
    runLabel: `RUN-${id}`,
    state: {},
    usedVersion: 1,
    workflowId: WF,
  };
}

function requestPage(content: unknown[], total = content.length, number = 0) {
  return {
    content,
    number,
    size: 25,
    totalElements: total,
    totalPages: Math.ceil(total / 25),
  };
}

type OpsOptions = {
  queues?: () => unknown[];
  views?: () => unknown[];
  processes?: () => unknown[];
  requests?: (route: Route, body: any) => unknown | Promise<unknown>;
};

/** Everything the Operations pages read. Register after bootstrap. */
async function mockOperations(page: Page, mockApi: MockApi, o: OpsOptions) {
  await mockApi.bootstrap(page);
  const log = { requests: [] as any[], queues: 0, signals: [] as any[] };
  await page.route(api('operations/queues'), (route) => {
    log.queues += 1;
    return json(route, envelope(o.queues?.() ?? [queue(1)]));
  });
  await page.route(api('operations/views'), (route) =>
    json(route, envelope(o.views?.() ?? [savedView()]))
  );
  await page.route(api('operations/processes'), (route) =>
    json(route, envelope(o.processes?.() ?? []))
  );
  await page.route(api('operations/requests/query'), async (route) => {
    const body = route.request().postDataJSON();
    log.requests.push(body);
    if (o.requests) {
      const result = await o.requests(route, body);
      if (result === undefined) return;
      return json(route, envelope(result));
    }
    return json(route, envelope(requestPage([request('a')])));
  });
  await page.route(api('signals/[^/]+'), (route) => {
    const body = route.request().postDataJSON();
    log.signals.push(body);
    return json(
      route,
      envelope({
        receiptId: `r_${log.signals.length}`,
        requestId: body.requestId,
        acceptedAt: '2026-01-01T00:00:01Z',
      })
    );
  });
  return log;
}

type RunMock = {
  status: string;
  pending: unknown[];
  instanceGets: number;
  failInstance: boolean;
};

async function mockRun(
  page: Page,
  mockApi: MockApi,
  initial: Partial<RunMock> = {}
) {
  await mockOperations(page, mockApi, { views: () => [] });
  const run: RunMock = {
    status: 'running',
    pending: [],
    instanceGets: 0,
    failInstance: false,
    ...initial,
  };
  await page.route(api(`workflows/${WF}/instances/[^/]+`), (route) => {
    run.instanceGets += 1;
    if (run.failInstance) return json(route, { message: 'boom' }, 500);
    const id = route.request().url().split('/instances/')[1].split('?')[0];
    return json(route, {
      data: {
        instance: {
          id,
          workflowId: WF,
          status: run.status,
          runLabel: `Label ${id}`,
          inputs: { data: {} },
          created: '2026-01-01T12:00:00Z',
          updated: '2026-01-01T12:00:00Z',
          usedVersion: 1,
          steps: [],
        },
      },
      message: 'ok',
      success: true,
    });
  });
  await page.route(
    api(`workflows/${WF}/instances/[^/]+/pending-input`),
    (route) =>
      json(
        route,
        envelope({ pendingInputs: run.pending, count: run.pending.length })
      )
  );
  await page.route(api(`workflows/${WF}/instances/[^/]+/steps`), (route) =>
    json(route, envelope({ steps: [], count: 0, totalCount: 0 }))
  );
  await page.route(
    api(`workflows/${WF}/instances/[^/]+/step-events`),
    (route) => json(route, envelope({ events: [], count: 0, totalCount: 0 }))
  );
  await page.route(api(`workflows/${WF}/versions/[^/]+/schemas`), (route) =>
    json(route, { stateSchema: {} })
  );
  return run;
}

const openSavedQueue = (page: Page) =>
  page.goto(`/operations/queues/${VIEW_ID}`);

test.describe('Operations audit', () => {
  test('OP-1 A failed poll on the Queue page replaces it and resets its state', async ({
    page,
    mockApi,
  }) => {
    await mockOperations(page, mockApi, {});
    let failing = false;
    let served = 0;
    await page.route(api('operations/queues'), (route) => {
      served += 1;
      return failing
        ? json(route, { message: 'boom' }, 500)
        : json(route, envelope([queue(1)]));
    });
    await openSavedQueue(page);

    const search = page.getByLabel('Search runs');
    await expect(page.getByRole('link', { name: 'RUN-a' })).toBeVisible();
    await search.fill('typed before the failure');

    failing = true;
    const before = served;
    const alert = page.getByText('Could not load queue. Refresh to try again.');
    await expect(alert).toBeVisible({ timeout: POLL + 5_000 });
    expect(served).toBeGreaterThan(before);
    // The whole page is gone, not just annotated.
    await expect(search).toHaveCount(0);

    failing = false;
    await expect(alert).toHaveCount(0, { timeout: POLL + 5_000 });
    await expect(page.getByLabel('Search runs')).toHaveValue('');
  });

  test('OP-2 A failed poll on the Run page replaces it, including form drafts', async ({
    page,
    mockApi,
  }) => {
    const run = await mockRun(page, mockApi, {
      pending: [
        {
          requestId: 'req_1',
          toolName: 'Approve',
          message: 'Need an answer',
          responseSchema: { comment: { type: 'string', required: true } },
        },
      ],
    });
    await page.goto(`/operations/runs/${WF}/${INST}`);

    await expect(page.getByText('Decision needed')).toBeVisible();
    const field = page.getByRole('textbox').last();
    await field.fill('draft answer');
    await expect(field).toHaveValue('draft answer');

    run.failInstance = true;
    const alert = page.getByText('Could not load this run.');
    await expect(alert).toBeVisible({ timeout: POLL + 5_000 });
    await expect(page.getByText('Decision needed')).toHaveCount(0);

    run.failInstance = false;
    await expect(alert).toHaveCount(0, { timeout: POLL + 5_000 });
    await expect(page.getByText('Decision needed')).toBeVisible();
    await expect(page.getByRole('textbox').last()).toHaveValue('');
  });

  test('OP-3 Queue answer editing has no cancel', async ({ page, mockApi }) => {
    await mockOperations(page, mockApi, {
      views: () => [savedView({ answers: { bulk: false, inline: 'comment' } })],
      requests: () =>
        requestPage([
          request('a', { comment: { type: 'string', required: true } }),
        ]),
    });
    await openSavedQueue(page);

    await page.getByRole('button', { name: 'Answer in place' }).click();
    const submit = page.getByRole('button', { name: 'Submit answer' });
    await expect(submit).toBeVisible();

    // The only control in the answer cell submits; there is no way back.
    const cell = page
      .getByRole('row', { name: /RUN-a/ })
      .getByRole('cell')
      .last();
    await expect(cell.getByRole('button')).toHaveText(['Submit answer']);
    await page.keyboard.press('Escape');
    await expect(submit).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Answer in place' })
    ).toHaveCount(0);
  });

  test('OP-4 PARTIAL: two options sent only when both clicks land in one task', async ({
    page,
    mockApi,
  }) => {
    const log = await mockOperations(page, mockApi, {
      requests: () => requestPage([request('a'), request('b')]),
    });
    await openSavedQueue(page);

    // Two real mouse clicks: the analysis chain settles in microtasks, so the
    // second click finds the row already showing its submission state.
    const rowA = page.getByRole('row', { name: /RUN-a/ });
    const approveA = rowA.getByRole('button', { name: 'Approve' });
    const rejectA = rowA.getByRole('button', { name: 'Reject' });
    await expect(approveA).toBeVisible();
    const a = (await approveA.boundingBox())!;
    const r = (await rejectA.boundingBox())!;
    await Promise.all([
      page.mouse.click(a.x + a.width / 2, a.y + a.height / 2),
      page.mouse.click(r.x + r.width / 2, r.y + r.height / 2),
    ]);
    await expect.poll(() => log.signals.length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(
      log.signals.filter((s) => s.requestId === 'req_a').length,
      'separate input events'
    ).toBe(1);

    // The same two clicks inside one task: nothing guards the analysis window.
    const rowB = page.getByRole('row', { name: /RUN-b/ });
    await rowB.getByRole('button', { name: 'Approve' }).evaluate((el) => {
      const buttons = el.parentElement!.querySelectorAll('button');
      (buttons[0] as HTMLElement).click();
      (buttons[1] as HTMLElement).click();
    });
    await expect
      .poll(() => log.signals.filter((s) => s.requestId === 'req_b').length)
      .toBe(2);
    const answers = log.signals
      .filter((s) => s.requestId === 'req_b')
      .map((s) => s.payload.decision)
      .sort();
    expect(answers).toEqual(['approve', 'reject']);
  });

  test('OP-5 "Submit prepared answers" does nothing for non-editing rows, with no feedback', async ({
    page,
    mockApi,
  }) => {
    const log = await mockOperations(page, mockApi, {});
    await openSavedQueue(page);

    await page.getByRole('checkbox', { name: /Select RUN-a/ }).check();
    await expect(page.getByText('1 requests selected')).toBeVisible();
    await page.getByRole('button', { name: 'Submit prepared answers' }).click();
    await page.waitForTimeout(1_500);

    expect(log.signals).toHaveLength(0);
    await expect(page.getByText('1 requests selected')).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);

    // Control: the row can answer, so the mock and form are live.
    await page
      .getByRole('row', { name: /RUN-a/ })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect.poll(() => log.signals.length).toBe(1);
  });

  test('OP-6 Answering everything on the last page strands an empty table', async ({
    page,
    mockApi,
  }) => {
    let answered = false;
    const log = await mockOperations(page, mockApi, {
      requests: (_route, body) => {
        const n = body.query.page;
        const first = Array.from({ length: 25 }, (_, i) => request(`p${i}`));
        if (answered)
          return n === 0 ? requestPage(first, 25, 0) : requestPage([], 25, n);
        return n === 0
          ? requestPage(first, 26, 0)
          : requestPage([request('last')], 26, 1);
      },
    });
    await openSavedQueue(page);

    await page.getByRole('button', { name: 'Next page' }).click();
    const last = page.getByRole('row', { name: /RUN-last/ });
    await last.getByRole('button', { name: 'Approve' }).click();
    await expect(last.getByRole('status')).toHaveText(/Answered|Sending/);
    answered = true;

    const body = page.locator('table tbody tr');
    await expect(body).toHaveCount(0, { timeout: POLL + 5_000 });
    // 25 requests still exist one page back, but nothing leads to them.
    expect(log.requests.at(-1).query.page).toBe(1);
    await expect(page.locator('table thead')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Previous page' })
    ).toHaveCount(0);
    await expect(
      page.getByText('No requests waiting for an answer.')
    ).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Open\s*25/ })).toBeVisible();
  });

  test('OP-7 The sort tooltip at descending says ascending, but clicking removes the sort', async ({
    page,
    mockApi,
  }) => {
    await mockOperations(page, mockApi, {
      views: () => [],
      processes: () => [
        {
          workflowId: WF,
          name: 'Orders',
          stateSchema: { amount: { type: 'number' } },
        },
      ],
    });
    const queries: any[] = [];
    await page.route(api('executions/query'), (route) => {
      queries.push(route.request().postDataJSON());
      return json(
        route,
        envelope({
          content: [],
          totalElements: 0,
          totalPages: 0,
          number: 0,
          size: 25,
        })
      );
    });
    await page.goto(`/operations/processes/${WF}`);

    const select = page.getByLabel('Sort by');
    await select.selectOption('amount');
    await page.getByRole('button', { name: 'Sort ascending' }).click();
    const descending = page.getByRole('button', { name: 'Sort descending' });
    await expect(descending).toBeVisible();

    // The click closed the tooltip; leave and come back to open it again.
    await page.mouse.move(0, 0);
    await descending.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'Descending — switch to ascending'
    );

    await descending.click();
    // Not ascending: the sort is gone altogether.
    await expect(select).toHaveValue('');
    await expect(
      page.getByRole('button', { name: /^Sort (a|de)scending$/ })
    ).toHaveCount(0);
    await expect.poll(() => queries.at(-1).stateSort ?? null).toBeNull();
    expect(queries.some((q) => q.stateSort?.descending === true)).toBe(true);
  });

  test('OP-8 Deleting a queue flashes "Queue not found"', async ({
    page,
    mockApi,
  }) => {
    let deleted = false;
    const hold = gate();
    await mockOperations(page, mockApi, {
      views: () => (deleted ? [] : [savedView()]),
    });
    await page.route(api('operations/queues'), async (route) => {
      if (deleted) await hold.opened;
      return json(route, envelope([queue(1)]));
    });
    await page.route(api(`operations/views/${VIEW_ID}\\?[^/]*`), (route) => {
      deleted = true;
      return json(route, envelope({}));
    });
    await openSavedQueue(page);

    await page
      .getByRole('button', { name: 'Delete queue Saved queue' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete queue' })
      .click();

    // The invalidation has refreshed the views while the queues list is still
    // on its way, and the page sits on the not-found copy.
    await expect(page.getByText('Queue not found.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/operations/queues/${VIEW_ID}$`));

    hold.open();
    await expect(page).toHaveURL(/\/operations\/queues$/);
  });

  test('OP-9 Run page polling continues after a terminal status', async ({
    page,
    mockApi,
  }) => {
    const run = await mockRun(page, mockApi, { status: 'completed' });
    await page.goto(`/operations/runs/${WF}/${INST}`);
    await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();

    const before = run.instanceGets;
    await page.waitForTimeout(POLL * 2 + 2_000);
    console.log(
      `OP-9 instance GETs after completed: ${run.instanceGets - before}`
    );
    expect(run.instanceGets - before).toBeGreaterThanOrEqual(2);
  });

  test('OP-10 The replay dialog can close mid-request and still navigate', async ({
    page,
    mockApi,
  }) => {
    await mockRun(page, mockApi, { status: 'completed' });
    const hold = gate();
    let replays = 0;
    await page.route(
      api(`workflows/instances/${INST}/replay`),
      async (route) => {
        replays += 1;
        await hold.opened;
        return json(route, envelope({ instanceId: 'inst_new' }));
      }
    );
    await page.goto(`/operations/runs/${WF}/${INST}`);

    await page.getByRole('button', { name: 'Replay' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirm Replay' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Queueing…' })
    ).toBeVisible();
    expect(replays).toBe(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/runs/${WF}/${INST}$`));

    hold.open();
    await expect(page).toHaveURL(new RegExp(`/runs/${WF}/inst_new$`));
  });

  test('OP-11 Retrying a queue delete after a revision conflict resends the same revision', async ({
    page,
    mockApi,
  }) => {
    await mockOperations(page, mockApi, {});
    const revisions: string[] = [];
    await page.route(api(`operations/views/${VIEW_ID}\\?[^/]*`), (route) => {
      revisions.push(
        new URL(route.request().url()).searchParams.get('revision')!
      );
      return json(route, { message: 'Revision conflict' }, 409);
    });
    await openSavedQueue(page);

    await page
      .getByRole('button', { name: 'Delete queue Saved queue' })
      .click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Delete queue' });
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText('Revision conflict');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => revisions.length).toBe(2);

    expect(revisions).toEqual(['1', '1']);
    await expect(dialog.getByRole('alert')).toHaveText('Revision conflict');
  });

  test('OP-12 A view editor 409 retry can never succeed', async ({
    page,
    mockApi,
  }) => {
    await mockOperations(page, mockApi, {});
    const SERVER_REVISION = 2;
    const puts: { revision: number; status: number }[] = [];
    await page.route(api(`operations/views/${VIEW_ID}`), (route) => {
      const { revision } = route.request().postDataJSON();
      const status = revision === SERVER_REVISION ? 200 : 409;
      puts.push({ revision, status });
      return status === 200
        ? json(route, envelope(savedView()))
        : json(route, { message: 'Revision conflict' }, 409);
    });
    await page.goto(`/operations/queues/${VIEW_ID}/edit`);

    const save = page.getByRole('button', { name: 'Save changes' });
    const conflict = page.getByText('Revision conflict');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await save.click();
      await expect.poll(() => puts.length).toBe(attempt);
      await expect(conflict).toBeVisible();
      await expect(save).toBeEnabled();
    }

    expect(puts.map((p) => p.revision)).toEqual([1, 1, 1]);
    expect(puts.map((p) => p.status)).toEqual([409, 409, 409]);
    await expect(page).toHaveURL(/\/edit$/);
  });

  test('OP-13 Any queue count change drops the Requests rows to loading', async ({
    page,
    mockApi,
  }) => {
    let count = 1;
    const hold = gate();
    await mockOperations(page, mockApi, {
      queues: () => [queue(count)],
      requests: async () => {
        if (count > 1) await hold.opened;
        return requestPage(
          Array.from({ length: count }, (_, i) => request(`r${i}`)),
          count
        );
      },
    });
    await page.goto('/operations/requests');

    const known = page.getByRole('link', { name: 'RUN-r0', exact: true });
    await expect(known).toBeVisible();

    count = 2;
    const loading = page.getByText('Loading requests…');
    await expect(loading).toBeVisible({ timeout: POLL + 5_000 });
    // The row is still valid and still open, yet it is gone.
    await expect(known).toHaveCount(0);

    hold.open();
    await expect(known).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'RUN-r1', exact: true })
    ).toBeVisible();
  });

  test('OP-14 A failed queues poll with an empty list shows "Requests unavailable"', async ({
    page,
    mockApi,
  }) => {
    await mockOperations(page, mockApi, { queues: () => [] });
    let failing = false;
    await page.route(api('operations/queues'), (route) =>
      failing
        ? json(route, { message: 'boom' }, 500)
        : json(route, envelope([]))
    );
    await page.goto('/operations/requests');

    const empty = page.getByText('No requests are waiting for an answer.');
    await expect(empty).toBeVisible();

    failing = true;
    await expect(page.getByText('Requests unavailable.')).toBeVisible({
      timeout: POLL + 5_000,
    });
    await expect(empty).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(
      'Could not refresh requests.'
    );
  });

  test('OP-15 The Overdue tile says "Not tracked yet" while loading and on error', async ({
    page,
    mockApi,
  }) => {
    const hold = gate();
    let mode: 'hold' | 'fail' | 'ok' = 'hold';
    const dueView = savedView({ roles: { due: 'due' } });
    await mockOperations(page, mockApi, {
      views: () => [dueView],
      requests: async (route) => {
        if (mode === 'hold') await hold.opened;
        if (mode === 'fail') {
          await json(route, { message: 'boom' }, 500);
          return undefined;
        }
        return requestPage([], 7);
      },
    });
    await page.route(api('executions/query'), (route) =>
      json(
        route,
        envelope({
          content: [],
          totalElements: 0,
          totalPages: 0,
          number: 0,
          size: 5,
        })
      )
    );
    await page.route(api('executions/summary'), (route) =>
      json(route, envelope({ total: 0, counts: {} }))
    );
    await page.goto('/operations');

    // A due field IS configured; the answer is simply not in yet.
    const tile = page.getByRole('link', { name: /Overdue/ });
    await expect(tile).toContainText('Not tracked yet');
    await expect(tile).toContainText('Choose a due field in a queue');

    mode = 'fail';
    hold.open();
    await expect(page.getByRole('alert')).toContainText(
      'Some Operations data could not be refreshed',
      { timeout: 15_000 }
    );
    await expect(tile).toContainText('Not tracked yet');

    // Control: once the same query succeeds, the same tile reports the number.
    mode = 'ok';
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(tile).toContainText('7');
    await expect(tile).not.toContainText('Not tracked yet');
  });
});

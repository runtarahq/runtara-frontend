import { expect, type Page, type Route } from '@playwright/test';
import { test, type MockApi } from '../fixtures';
import { api, json, knownDefect } from './helpers';

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
  test('OP-1 A failed poll on the Queue page keeps it and its state', async ({
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
    // Two failures in a row, as the client retries once; then let them land.
    await expect
      .poll(() => served - before, { timeout: POLL + 5_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(2_000);

    // Fixed: the loaded page stays, with a note that the refresh failed.
    await expect(search).toHaveValue('typed before the failure');
    await expect(page.getByText('Could not refresh the queue')).toBeVisible();

    // Control: the page is back once the poll recovers.
    failing = false;
    await expect(page.getByLabel('Search runs')).toBeVisible({
      timeout: POLL + 5_000,
    });
  });

  test('OP-2 A failed poll on the Run page keeps it, including form drafts', async ({
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

    const before = run.instanceGets;
    run.failInstance = true;
    // Two failures in a row, as the client retries once; then let them land.
    await expect
      .poll(() => run.instanceGets - before, { timeout: POLL + 5_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(2_000);

    // Fixed: the loaded run stays, draft included, with a note.
    await expect(page.getByText('Decision needed')).toBeVisible();
    await expect(field).toHaveValue('draft answer');
    await expect(page.getByText('Could not refresh this run')).toBeVisible();

    // Control: the page is back once the poll recovers.
    run.failInstance = false;
    await expect(page.getByText('Decision needed')).toBeVisible({
      timeout: POLL + 5_000,
    });
  });

  test('OP-3 Queue answer editing can be cancelled', async ({
    page,
    mockApi,
  }) => {
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

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(submit).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Answer in place' })
    ).toBeVisible();
  });

  test('OP-4 Clicking two options sends one answer, even when both clicks land in one task', async ({
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
      .toBeGreaterThan(0);
    // The count passes through 1 on its way to 2: wait before reading it.
    await page.waitForTimeout(500);
    // Fixed: one choice at a time, even within one task.
    expect(
      log.signals.filter((s) => s.requestId === 'req_b').length,
      'clicks in one task'
    ).toBe(1);
  });

  test('OP-5 "Submit prepared answers" on non-editing rows acts or gives feedback', async ({
    page,
    mockApi,
  }) => {
    const log = await mockOperations(page, mockApi, {});
    await openSavedQueue(page);

    await page.getByRole('checkbox', { name: /Select RUN-a/ }).check();
    await expect(page.getByText('1 requests selected')).toBeVisible();
    await page.getByRole('button', { name: 'Submit prepared answers' }).click();

    // Sending or explaining why not are both fine; doing nothing silently is not.
    await expect
      .poll(
        async () =>
          log.signals.length +
          (await page.locator('[data-sonner-toast]').count()) +
          (await page.getByRole('alert').count()) +
          (await page.getByRole('status').count()),
        { timeout: 1_500 }
      )
      .toBeGreaterThan(0);

    // Control: the row can answer, so the mock and form are live.
    await page
      .getByRole('row', { name: /RUN-a/ })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect.poll(() => log.signals.length).toBe(1);
  });

  test('OP-6 Answering everything on the last page leaves a way to the remaining requests', async ({
    page,
    mockApi,
  }) => {
    let answered = false;
    await mockOperations(page, mockApi, {
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

    // The poll has landed: the old pager and the old row went with it.
    await expect(last).toHaveCount(0, { timeout: POLL + 5_000 });

    // Rows, a pager or the empty text: anything but a bare table header.
    await expect(
      page
        .locator('table tbody tr')
        .or(page.getByRole('button', { name: 'Previous page' }))
        .or(page.getByText('No requests waiting for an answer.'))
        .first()
    ).toBeVisible();
    // Control: 25 requests still exist, and the next poll counts them.
    await expect(page.getByRole('tab', { name: /Open\s*25/ })).toBeVisible({
      timeout: POLL + 5_000,
    });
  });

  test('OP-7 The sort tooltip at descending says what clicking does', async ({
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
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    const promisesAscending = /ascending/i.test(await tooltip.innerText());
    expect(queries.some((q) => q.stateSort?.descending === true)).toBe(true);

    expect(promisesAscending).toBe(true);

    await descending.click();
    // The sort flips to ascending on the same field rather than clearing.
    await expect(
      page.getByRole('button', { name: 'Sort ascending' })
    ).toBeVisible();
    await expect(select).toHaveValue('amount');
  });

  test('OP-8 Deleting a queue does not flash "Queue not found"', async ({
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

    // Let the invalidation refresh the views while the queues list is held.
    await expect.poll(() => deleted).toBe(true);
    await page.waitForTimeout(1_000);
    // Fixed: the page is left before the lists refresh.
    await expect(page.getByText('Queue not found.')).toHaveCount(0);

    hold.open();
    await expect(page).toHaveURL(/\/operations\/queues$/);
  });

  test('OP-9 Run page polling stops after a terminal status', async ({
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
    expect(run.instanceGets - before).toBeLessThan(2);
  });

  test('OP-10 The replay dialog does not close mid-request and then navigate', async ({
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
    // Past the close animation, if the dialog closes at all.
    await page.waitForTimeout(1_000);
    const closed = (await dialog.count()) === 0;

    const replayed = page.waitForResponse(
      api(`workflows/instances/${INST}/replay`)
    );
    hold.open();
    await replayed;
    await page.waitForTimeout(1_000);
    const navigated = page.url().endsWith(`/runs/${WF}/inst_new`);

    // Refusing to close and not navigating after a close are both fine.
    // Fixed: a dialog closed mid-request does not navigate when it answers.
    expect(closed && navigated, 'closed mid-request, then navigated').toBe(
      false
    );
  });

  test('OP-11 Retrying a queue delete after a revision conflict sends the current revision', async ({
    page,
    mockApi,
  }) => {
    // The server moved to revision 2 once it refused revision 1, and the views
    // list says so; otherwise no client could ever send the current revision.
    let serverRevision = 1;
    await mockOperations(page, mockApi, {
      views: () => [{ ...savedView(), revision: serverRevision }],
    });
    const revisions: string[] = [];
    await page.route(api(`operations/views/${VIEW_ID}\\?[^/]*`), (route) => {
      const revision = new URL(route.request().url()).searchParams.get(
        'revision'
      )!;
      revisions.push(revision);
      if (revision === '2') return json(route, envelope({}));
      serverRevision = 2;
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

    await knownDefect('OP-11', async () => {
      expect(revisions).toEqual(['1', '2']);
    });
  });

  test('OP-12 A view editor 409 retry can succeed', async ({
    page,
    mockApi,
  }) => {
    // The views list reports the new revision once the server has refused the
    // old one; otherwise no client could ever send it.
    const SERVER_REVISION = 2;
    let listedRevision = 1;
    await mockOperations(page, mockApi, {
      views: () => [{ ...savedView(), revision: listedRevision }],
    });
    const puts: { revision: number; status: number }[] = [];
    await page.route(api(`operations/views/${VIEW_ID}`), (route) => {
      const { revision } = route.request().postDataJSON();
      const status = revision === SERVER_REVISION ? 200 : 409;
      puts.push({ revision, status });
      listedRevision = SERVER_REVISION;
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
      if (puts.at(-1)!.status === 200) break;
      await expect(conflict).toBeVisible();
      await expect(save).toBeEnabled();
    }

    await knownDefect('OP-12', async () => {
      expect(puts.map((p) => p.status)).toContain(200);
    });
  });

  test('OP-13 A queue count change keeps the Requests rows on screen', async ({
    page,
    mockApi,
  }) => {
    let count = 1;
    const hold = gate();
    const log = await mockOperations(page, mockApi, {
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

    const queuePolls = log.queues;
    const requestQueries = log.requests.length;
    count = 2;
    // The new count has landed and its held request has gone out.
    await expect
      .poll(() => log.queues, { timeout: POLL + 5_000 })
      .toBeGreaterThan(queuePolls);
    await page.waitForTimeout(1_000);
    expect(log.requests.length).toBeGreaterThan(requestQueries);

    // The row is still valid and still open, so it should still be there.
    await knownDefect('OP-13', async () => {
      await expect(known).toBeVisible();
    });

    hold.open();
    await expect(known).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'RUN-r1', exact: true })
    ).toBeVisible();
  });

  test('OP-14 A failed queues poll with an empty list keeps the empty text', async ({
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
    // The alert annotating the failed refresh is fine, and shows it landed.
    await expect(page.getByRole('alert')).toContainText(
      'Could not refresh requests.',
      { timeout: POLL + 5_000 }
    );
    // Fixed: the loaded empty list keeps its text.
    await expect(page.getByText('Requests unavailable.')).toHaveCount(0);
    await expect(empty).toBeVisible();
  });

  test('OP-15 The Overdue tile does not say "Not tracked yet" while loading or on error', async ({
    page,
    mockApi,
  }) => {
    const hold = gate();
    let mode: 'hold' | 'fail' | 'ok' = 'hold';
    const dueView = savedView({ roles: { due: 'due' } });
    const log = await mockOperations(page, mockApi, {
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
    await expect(tile).toBeVisible();
    await expect.poll(() => log.requests.length).toBeGreaterThan(0);
    await knownDefect('OP-15', async () => {
      await expect(tile).not.toContainText('Not tracked yet');
    });

    mode = 'fail';
    hold.open();
    await expect(page.getByRole('alert')).toContainText(
      'Some Operations data could not be refreshed',
      { timeout: 15_000 }
    );
    await knownDefect('OP-15', async () => {
      await expect(tile).not.toContainText('Not tracked yet');
    });

    // Control: once the same query succeeds, the same tile reports the number.
    mode = 'ok';
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(tile).toContainText('7');
    await expect(tile).not.toContainText('Not tracked yet');
  });
});

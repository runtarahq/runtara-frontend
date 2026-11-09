import { expect, type Page } from '@playwright/test';
import { test, buildWorkflow, type MockApi } from '../fixtures';
import { api, json, logWorkflow, openWorkflow } from './helpers';

const WF = 'wf_hist';
const INST = 'inst_hist';
const POLL = 10_000;
const FAILED_COPY = 'Failed to load execution details';

const envelope = (data: unknown) => ({ data, success: true });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

type RunMock = {
  status: string;
  fail: boolean;
  gets: number[];
  pendingGets: number;
  pending: unknown[];
  steps: unknown[];
};

/** Everything the run history page reads. */
async function mockRun(
  page: Page,
  mockApi: MockApi,
  initial: Partial<RunMock> = {}
) {
  await mockApi.bootstrap(page);
  const run: RunMock = {
    status: 'running',
    fail: false,
    gets: [],
    pendingGets: 0,
    pending: [],
    steps: [],
    ...initial,
  };
  await page.route(api(`workflows/${WF}/instances/${INST}`), (route) => {
    run.gets.push(Date.now());
    if (run.fail) return json(route, { message: 'boom' }, 500);
    return json(route, {
      data: {
        instance: {
          id: INST,
          workflowId: WF,
          status: run.status,
          inputs: { data: { hello: 'world' } },
          outputs: { ok: true },
          created: '2026-01-01T12:00:00Z',
          updated: '2026-01-01T12:00:00Z',
          usedVersion: 1,
          steps: [],
        },
        metadata: { workflowName: 'History workflow' },
      },
      message: 'ok',
      success: true,
    });
  });
  await page.route(
    api(`workflows/${WF}/instances/${INST}/pending-input`),
    (route) => {
      run.pendingGets += 1;
      return json(
        route,
        envelope({ pendingInputs: run.pending, count: run.pending.length })
      );
    }
  );
  await page.route(api(`workflows/${WF}/instances/${INST}/steps`), (route) =>
    json(
      route,
      envelope({
        steps: run.steps,
        count: run.steps.length,
        totalCount: run.steps.length,
      })
    )
  );
  await page.route(
    api(`workflows/${WF}/instances/${INST}/step-events`),
    (route) => json(route, envelope({ events: [], count: 0, totalCount: 0 }))
  );
  return run;
}

const openRun = (page: Page) => page.goto(`/workflows/${WF}/history/${INST}`);

function execution(id: string) {
  return {
    id,
    workflowId: WF,
    workflowName: 'History workflow',
    runLabel: `RUN-${id}`,
    status: 'completed',
    usedVersion: 1,
    created: '2026-01-01T12:00:00Z',
    updated: '2026-01-01T12:00:02Z',
  };
}

const emptyExecutions = {
  data: {
    content: [],
    number: 0,
    size: 5,
    numberOfElements: 0,
    totalElements: 0,
    totalPages: 0,
    first: true,
    last: true,
  },
  success: true,
};

/** The Operations Runs page, logging each list request's page and filters. */
async function mockRuns(page: Page, mockApi: MockApi) {
  await mockApi.bootstrap(page);
  await mockApi.workflows.list(page, []);
  const list: URLSearchParams[] = [];
  await page.route(api('executions'), (route) => {
    const query = new URL(route.request().url()).searchParams;
    list.push(query);
    const number = Number(query.get('page') ?? 0);
    return json(route, {
      data: {
        content: [execution(`p${number}`)],
        number,
        size: 10,
        numberOfElements: 1,
        totalElements: 30,
        totalPages: 3,
        first: number === 0,
        last: number === 2,
      },
      success: true,
    });
  });
  await page.route(api('executions/summary'), (route) =>
    json(route, envelope({ total: 30, counts: { failed: 2, completed: 28 } }))
  );
  return list;
}

const inputWorkflow = buildWorkflow({
  id: 'wf_grid',
  name: 'Grid workflow',
  inputSchema: { name: { type: 'string', required: true } },
} as never);
const plainWorkflow = buildWorkflow({
  id: 'wf_plain',
  name: 'Plain workflow',
  inputSchema: {},
} as never);

async function openGrid(page: Page, mockApi: MockApi) {
  await mockApi.bootstrap(page);
  await mockApi.workflows.list(page, [inputWorkflow, plainWorkflow]);
}

const rowOf = (page: Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

test.describe('History audit', () => {
  test('HI-1 A first-load failure on run history spins forever', async ({
    page,
    mockApi,
  }) => {
    const run = await mockRun(page, mockApi, { fail: true });
    await openRun(page);

    // Attempt + one retry from the QueryClient default (1 s), then idle.
    await expect.poll(() => run.gets.length).toBe(2);
    await page.waitForTimeout(8_000);

    expect(run.gets.length, 'no further attempts').toBe(2);
    await expect(page.locator('.animate-spin').first()).toBeVisible();
    await expect(page.getByText(FAILED_COPY)).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Workflow Execution Details' })
    ).toHaveCount(0);
  });

  test('HI-2 One failed poll replaces a loaded run history page', async ({
    page,
    mockApi,
  }) => {
    const run = await mockRun(page, mockApi);
    await openRun(page);

    const heading = page.getByRole('heading', {
      name: 'Workflow Execution Details',
    });
    const search = page.getByLabel('Search keys and values');
    await expect(heading).toBeVisible();
    await search.fill('world');
    await expect(search).toHaveValue('world');

    run.fail = true;
    const failed = page.getByText(FAILED_COPY);
    await expect(failed).toBeVisible({ timeout: POLL + 5_000 });
    await expect(heading).toHaveCount(0);

    run.fail = false;
    await expect(heading).toBeVisible({ timeout: POLL + 5_000 });
    await expect(failed).toHaveCount(0);
    await expect(page.getByLabel('Search keys and values')).toHaveValue('');
  });

  test('HI-3 The timeline poll never runs: requests come at 10 s, not 5 s', async ({
    page,
    mockApi,
  }) => {
    const run = await mockRun(page, mockApi);
    await openRun(page);
    await expect(
      page.getByRole('heading', { name: 'Workflow Execution Details' })
    ).toBeVisible();

    const pendingBefore = run.pendingGets;
    await page.waitForTimeout(32_000);

    const gaps = run.gets.slice(1).map((at, i) => at - run.gets[i]);
    console.log(
      `HI-3 instance gaps ms: ${gaps.join(',')}; pending GETs: ${run.pendingGets - pendingBefore}`
    );
    // Control: the 3 s pending-input poll runs, so timers are live.
    expect(run.pendingGets - pendingBefore).toBeGreaterThanOrEqual(8);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    // A live 5 s poll on the shared key would show gaps near 5 s.
    for (const gap of gaps) expect(gap).toBeGreaterThan(8_000);
  });

  test('HI-4 Stale pending inputs still feed the timeline after a run finishes', async ({
    page,
    mockApi,
  }) => {
    const stepsRunning = [
      {
        stepId: 'agent',
        stepName: 'Agent step',
        stepType: 'Log',
        status: 'running',
        startedAt: '2026-01-01T12:00:00Z',
      },
    ];
    const run = await mockRun(page, mockApi, {
      steps: stepsRunning,
      pending: [
        {
          requestId: 'req_1',
          aiAgentStepId: 'agent',
          toolName: 'approve',
          message: 'Please approve this run',
          responseSchema: {},
        },
      ],
    });
    // The poll that reports the run finished is also the moment the request
    // stops being open: from here on the backend has nothing pending.
    await page.route(api(`workflows/${WF}/instances/${INST}`), (route) => {
      if (Date.now() >= finishAt) {
        run.status = 'failed';
        run.pending = [];
      }
      return route.fallback();
    });
    const finishAt = Date.now() + 5_000;
    await openRun(page);

    await page.getByText('Agent step', { exact: true }).first().click();
    await expect(page.getByText('waiting for input')).toBeVisible();

    await expect
      .poll(() => run.status, { timeout: POLL + 8_000 })
      .toBe('failed');
    await expect(
      page.getByRole('button', { name: 'Replay', exact: true })
    ).toBeVisible();
    const pendingAtFinish = run.pendingGets;
    await page.waitForTimeout(5_000);

    expect(run.pending).toHaveLength(0);
    expect(run.pendingGets, 'pending-input polling stopped').toBe(
      pendingAtFinish
    );
    // Finished, nothing pending on the server, and the timeline still waits.
    await expect(page.getByText('waiting for input')).toBeVisible();
  });

  test('HI-5 An empty history list shows a skeleton on every poll', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow(WF);
    let requests = 0;
    const hold = gate();
    await openWorkflow(page, mockApi, wf, async () => {
      await page.route(api('executions'), async (route) => {
        requests += 1;
        if (requests > 1) await hold.opened;
        return json(route, emptyExecutions);
      });
    });

    await page.getByRole('button', { name: /History/ }).click();
    const empty = page.getByText('No executions yet');
    await expect(empty).toBeVisible();
    const before = requests;

    const skeleton = page.locator('.animate-pulse');
    await expect(skeleton.first()).toBeVisible({ timeout: POLL + 5_000 });
    expect(requests).toBeGreaterThan(before);
    await expect(empty).toHaveCount(0);

    hold.open();
    await expect(empty).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });

  test('HI-6 A failed history list reads as "No executions yet"', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow(WF);
    let requests = 0;
    await openWorkflow(page, mockApi, wf, async () => {
      await page.route(api('executions'), (route) => {
        requests += 1;
        return json(route, { message: 'boom' }, 500);
      });
    });

    await page.getByRole('button', { name: /History/ }).click();
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);

    await expect(page.getByText('No executions yet')).toBeVisible();
    await expect(
      page.getByText('Run the workflow to see history here')
    ).toBeVisible();
    await expect(
      page.getByText(/could not|failed to|unavailable/i)
    ).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('HI-7 A filter change first requests the new filters on the old page', async ({
    page,
    mockApi,
  }) => {
    const list = await mockRuns(page, mockApi);
    await page.goto('/operations/runs');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect.poll(() => list.at(-1)?.get('page')).toBe('1');

    const start = list.length;
    await page.getByRole('button', { name: /^Failed/ }).click();
    await expect
      .poll(() => list.slice(start).map((q) => q.get('page')))
      .toEqual(['1', '0']);

    const seen = list.slice(start);
    expect(seen.map((q) => q.get('status'))).toEqual([
      'failed,timeout',
      'failed,timeout',
    ]);
    // Control: it settles on the first page of the new filter.
    await expect(page).toHaveURL(/status=failed/);
    await expect(
      page.getByRole('link', { name: 'RUN-p0', exact: true }).first()
    ).toBeVisible();
  });

  test('HI-8 Typing during the search debounce can lose a trailing space', async ({
    page,
    mockApi,
  }) => {
    const list = await mockRuns(page, mockApi);
    await page.goto('/operations/runs');
    await page.getByRole('button', { name: /^Search/ }).click();
    const search = page.getByPlaceholder('Search runs…');
    await expect(search).toBeVisible();

    await search.pressSequentially('foo ', { delay: 20 });
    await expect(search).toHaveValue('foo ');
    await expect
      .poll(() => list.some((q) => q.get('search') === 'foo'))
      .toBe(true);

    // The URL write-back replaced the box's copy, eating the space.
    await expect(search).toHaveValue('foo');
    await search.pressSequentially('bar', { delay: 20 });
    await expect(search).toHaveValue('foobar');
    await expect.poll(() => list.at(-1)?.get('search')).toBe('foobar');
    expect(list.some((q) => q.get('search') === 'foo bar')).toBe(false);
  });

  test('HI-9 ?range=all&createdFrom= shows "All time" but filters by date', async ({
    page,
    mockApi,
  }) => {
    const list = await mockRuns(page, mockApi);
    const from = '2026-01-01T00:00:00Z';
    await page.goto(`/operations/runs?range=all&createdFrom=${from}`);

    await expect(page.getByRole('button', { name: 'Time range' })).toHaveText(
      /All time/
    );
    await expect(
      page.getByRole('link', { name: 'RUN-p0', exact: true }).first()
    ).toBeVisible();
    expect(list.length).toBeGreaterThan(0);
    for (const query of list) expect(query.get('createdFrom')).toBe(from);
  });

  test('HI-10 Retrying execute leaves the old error visible', async ({
    page,
    mockApi,
  }) => {
    await openGrid(page, mockApi);
    const hold = gate();
    let attempts = 0;
    await page.route(
      api(`workflows/${inputWorkflow.id}/execute`),
      async (route) => {
        attempts += 1;
        if (attempts === 2) await hold.opened;
        return json(route, { message: `boom-${attempts}` }, 500);
      }
    );
    await page.goto('/workflows');

    const row = rowOf(page, 'Grid workflow');
    await row.hover();
    await row.getByTitle('Start').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('value');
    await dialog.getByRole('button', { name: 'Execute' }).click();
    await expect(dialog.getByText('boom-1')).toBeVisible();

    await dialog.getByRole('button', { name: 'Execute' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Executing...' })
    ).toBeVisible();
    await expect.poll(() => attempts).toBe(2);
    // The retry is in flight and the previous failure is still on screen.
    await expect(dialog.getByText('boom-1')).toBeVisible();

    hold.open();
    await expect(dialog.getByText('boom-2')).toBeVisible();
    await expect(dialog.getByText('boom-1')).toHaveCount(0);
  });

  test('HI-11 Delete and move close their dialogs on failure, while execute stays open', async ({
    page,
    mockApi,
  }) => {
    await openGrid(page, mockApi);
    const hits = { delete: 0, move: 0, execute: 0 };
    await page.route(api(`workflows/${inputWorkflow.id}/delete`), (route) => {
      hits.delete += 1;
      return json(route, { message: 'delete-boom' }, 500);
    });
    await page.route(api(`workflows/${inputWorkflow.id}/move`), (route) => {
      hits.move += 1;
      return json(route, { message: 'move-boom' }, 500);
    });
    await page.route(api(`workflows/${inputWorkflow.id}/execute`), (route) => {
      hits.execute += 1;
      return json(route, { message: 'execute-boom' }, 500);
    });
    await page.goto('/workflows');
    const row = rowOf(page, 'Grid workflow');
    await row.hover();

    await row.getByTitle('Delete').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect.poll(() => hits.delete).toBe(1);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    await expect(page.getByText('delete-boom').first()).toBeVisible();

    await row.hover();
    await row.getByTitle('Move to folder').click();
    const move = page.getByRole('dialog');
    await move.getByRole('button', { name: 'Create new folder' }).click();
    await move.getByPlaceholder('Enter folder name...').fill('ops');
    await move.getByRole('button', { name: 'Create & Move' }).click();
    await expect.poll(() => hits.move).toBe(1);
    await expect(page.getByText('Move workflow')).toHaveCount(0);
    await expect(page.getByText('move-boom').first()).toBeVisible();

    await row.hover();
    await row.getByTitle('Start').click();
    const execute = page.getByRole('dialog');
    await execute.getByRole('textbox').fill('value');
    await execute.getByRole('button', { name: 'Execute' }).click();
    await expect.poll(() => hits.execute).toBe(1);
    await expect(execute.getByText('execute-boom')).toBeVisible();
    await expect(execute.getByRole('textbox')).toHaveValue('value');
  });

  test('HI-12 DENIED: moving a root workflow to root cannot be confirmed; the button is disabled', async ({
    page,
    mockApi,
  }) => {
    await openGrid(page, mockApi);
    let moves = 0;
    await page.route(api(`workflows/${inputWorkflow.id}/move`), (route) => {
      moves += 1;
      return json(route, envelope({ path: '/ops/' }));
    });
    await page.goto('/workflows');
    const row = rowOf(page, 'Grid workflow');
    await row.hover();
    await row.getByTitle('Move to folder').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Current')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Move here' });
    await expect(confirm).toBeDisabled();

    // Re-selecting root by hand changes nothing.
    await dialog
      .getByRole('button', { name: /Root \(All Workflows\)/ })
      .click();
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true }).catch(() => {});
    await expect(dialog).toBeVisible();
    expect(moves).toBe(0);

    // Control: a real destination does confirm and send.
    await dialog.getByRole('button', { name: 'Create new folder' }).click();
    await dialog.getByPlaceholder('Enter folder name...').fill('ops');
    await dialog.getByRole('button', { name: 'Create & Move' }).click();
    await expect.poll(() => moves).toBe(1);
  });
});

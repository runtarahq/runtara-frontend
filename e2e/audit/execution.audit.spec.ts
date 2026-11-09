import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures';
import { api, json, knownDefect, logWorkflow, openWorkflow } from './helpers';

type RunState = {
  status: string;
  suspensionReason?: string | null;
  events: unknown[];
  eventsDelayed?: boolean;
};

const breakpointEvent = (id: number) => ({
  id,
  eventType: 'custom',
  subtype: 'breakpoint_hit',
  payload: { step_id: 'log', step_name: 'Log', step_type: 'Log', inputs: {} },
});

async function mockRuns(page: Page, workflowId: string) {
  const runs = new Map<string, RunState>();
  const order: string[] = [];
  const counters = { executes: 0 };
  let nextRun: () => RunState = () => ({ status: 'running', events: [] });
  const ctl = {
    runs,
    order,
    counters,
    setNext: (fn: () => RunState) => {
      nextRun = fn;
    },
    latest: () => runs.get(order[order.length - 1])!,
  };
  await page.route(api(`workflows/${workflowId}/execute`), (route) => {
    counters.executes += 1;
    const id = `inst_${counters.executes}`;
    runs.set(id, nextRun());
    order.push(id);
    return json(route, {
      data: { instanceId: id, status: 'queued' },
      success: true,
    });
  });
  await page.route(api(`workflows/${workflowId}/instances/[^/]+`), (route) => {
    const id = route.request().url().split('/instances/')[1].split('?')[0];
    const run = runs.get(id);
    return json(route, {
      data: {
        instance: {
          id,
          workflowId,
          status: run?.status ?? 'running',
          suspensionReason: run?.suspensionReason ?? null,
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
    api(`workflows/${workflowId}/instances/[^/]+/step-events`),
    (route) => {
      const id = route.request().url().split('/instances/')[1].split('/')[0];
      const events = runs.get(id)?.events ?? [];
      return json(route, {
        data: { events, count: events.length, totalCount: events.length },
        success: true,
      });
    }
  );
  await page.route(api('workflows/instances/[^/]+/resume'), (route) => {
    const id = route.request().url().split('/instances/')[1].split('/')[0];
    const run = runs.get(id);
    if (run) {
      run.status = 'running';
      run.suspensionReason = null;
    }
    return json(route, { success: true });
  });
  await page.route(api('workflows/instances/[^/]+/stop'), (route) =>
    json(route, { success: true })
  );
  return ctl;
}

const paused = (events: unknown[]): RunState => ({
  status: 'suspended',
  suspensionReason: 'paused',
  events,
});

const debugButton = (page: Page) =>
  page.getByTitle('Debug workflow (pause at breakpoints)');
const continueButton = (page: Page) =>
  page.getByTitle('Continue execution to next breakpoint');
const pausedLabel = (page: Page) => page.getByText('Paused at breakpoint');

/** Reads the app's own store through the dev server's module graph. */
const storeBreakpoint = (page: Page) =>
  page.evaluate(async () => {
    const path = '/src/features/workflows/stores/executionStore.ts';
    const { useExecutionStore } = await import(/* @vite-ignore */ path);
    const state = useExecutionStore.getState();
    return {
      isSuspended: state.isSuspended,
      stepId: state.breakpointHit?.stepId ?? null,
    };
  });

test.describe('Execution audit', () => {
  test('EX-1 After Stop, a new debug run pausing at the same step offers Continue', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_ex1', { breakpoint: true });
    let runs!: Awaited<ReturnType<typeof mockRuns>>;
    await openWorkflow(page, mockApi, wf, async () => {
      runs = await mockRuns(page, wf.id!);
    });

    runs.setNext(() => paused([breakpointEvent(1)]));
    await debugButton(page).click();
    await expect(pausedLabel(page)).toBeVisible({ timeout: 10_000 });
    await expect(continueButton(page)).toBeVisible();

    await page.getByTitle('Stop execution').click();
    await expect(debugButton(page)).toBeEnabled({ timeout: 10_000 });

    // Same step, brand-new run: a correct UI would pause again.
    runs.setNext(() => paused([breakpointEvent(1)]));
    await debugButton(page).click();
    await expect(page.getByText('Execution in progress')).toBeVisible({
      timeout: 10_000,
    });
    // Fixed: a hit is keyed by run and event, not by step.
    await expect(pausedLabel(page)).toBeVisible({ timeout: 6_000 });
    await expect(continueButton(page)).toBeVisible();
  });

  test('EX-2 A second pause at the same step (loop) offers Continue', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_ex2', { breakpoint: true });
    let runs!: Awaited<ReturnType<typeof mockRuns>>;
    await openWorkflow(page, mockApi, wf, async () => {
      runs = await mockRuns(page, wf.id!);
    });

    runs.setNext(() => paused([breakpointEvent(1)]));
    await debugButton(page).click();
    await expect(continueButton(page)).toBeVisible({ timeout: 10_000 });
    await continueButton(page).click();

    // Let the client see `running`, so the just-resumed guard clears.
    await expect(continueButton(page)).toHaveCount(0);
    await page.waitForTimeout(3_000);

    // The loop reaches the same step again, as a new event.
    const run = runs.latest();
    run.events = [breakpointEvent(2), breakpointEvent(1)];
    run.status = 'suspended';
    run.suspensionReason = 'paused';

    // Fixed: the second hit is a new event, so it offers Continue again.
    await expect(continueButton(page)).toBeVisible({ timeout: 8_000 });
    await expect(pausedLabel(page)).toBeVisible();
  });

  test('EX-3 A repeat event arriving after the paused status fills in the details', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_ex3', { breakpoint: true });
    let runs!: Awaited<ReturnType<typeof mockRuns>>;
    await openWorkflow(page, mockApi, wf, async () => {
      runs = await mockRuns(page, wf.id!);
    });

    // Control: the first pause carries its breakpoint details.
    runs.setNext(() => paused([breakpointEvent(1)]));
    await debugButton(page).click();
    await expect(continueButton(page)).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => storeBreakpoint(page))
      .toMatchObject({
        isSuspended: true,
        stepId: 'log',
      });
    await page.getByTitle('Stop execution').click();
    await expect(debugButton(page)).toBeEnabled({ timeout: 10_000 });

    // New run, same step: the paused status arrives before its event.
    runs.setNext(() => paused([]));
    await debugButton(page).click();
    await expect(continueButton(page)).toBeVisible({ timeout: 10_000 });
    await expect(pausedLabel(page)).toBeVisible();
    expect(await storeBreakpoint(page)).toEqual({
      isSuspended: true,
      stepId: null,
    });

    // Fixed: the event arrives, and as a hit of this run it fills the details.
    runs.latest().events = [breakpointEvent(2)];
    await expect
      .poll(() => storeBreakpoint(page), { timeout: 4_000 })
      .toEqual({ isSuspended: true, stepId: 'log' });
  });

  test('EX-4 A pause reached during the resume guard is detected once it expires', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_ex4', { breakpoint: true });
    let runs!: Awaited<ReturnType<typeof mockRuns>>;
    await openWorkflow(page, mockApi, wf, async () => {
      runs = await mockRuns(page, wf.id!);
    });

    const first = {
      ...breakpointEvent(1),
      payload: { ...breakpointEvent(1).payload, step_id: 'log' },
    };
    runs.setNext(() => paused([first]));
    await debugButton(page).click();
    await expect(continueButton(page)).toBeVisible({ timeout: 10_000 });

    // Resume is accepted, but the run is already paused at a different step:
    // the client never sees a non-suspended status.
    await page.route(api('workflows/instances/[^/]+/resume'), (route) => {
      const run = runs.latest();
      run.status = 'suspended';
      run.suspensionReason = 'paused';
      run.events = [
        {
          ...breakpointEvent(2),
          payload: { ...breakpointEvent(2).payload, step_id: 'other' },
        },
        first,
      ];
      return json(route, { success: true });
    });
    await continueButton(page).click();

    // Well past the 5 s guard, with polls still returning identical data.
    // The resume took effect, so a Continue seen below is a new one.
    await expect(continueButton(page)).toHaveCount(0);

    await knownDefect('EX-4', async () => {
      await expect(continueButton(page)).toBeVisible({ timeout: 12_000 });
      await expect(pausedLabel(page)).toBeVisible();
    });
  });
});

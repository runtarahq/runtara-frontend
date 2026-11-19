import { expect, test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Seeds what the operations specs (tests/operations*.local.e2e.spec.ts) read:
// a workflow that waits for an approval, three runs of it, one answered and
// replayed, a saved queue over the open requests, and a run that fails. It
// does through the API what runtara's own acceptance script does
// (e2e/test_operations.py there), and writes the ids to the file the specs
// take from E2E_OPERATIONS_FIXTURE.
//
// Runs only when E2E_SEED_OPERATIONS=true (playwright.config.ts), against a
// disposable server in local auth: nothing it creates is deleted.

const apiBase = `${process.env.E2E_RUNTIME_URL || 'http://127.0.0.1:7001'}/api/runtime`;
const output = process.env.E2E_OPERATIONS_FIXTURE!;

const immediate = (value: unknown) => ({ valueType: 'immediate', value });
const reference = (value: string) => ({ valueType: 'reference', value });

setup('seed the operations fixture', async ({ request }) => {
  setup.setTimeout(10 * 60 * 1000);

  const api = async (
    apiPath: string,
    body?: unknown,
    options: { method?: 'PUT'; expected?: number } = {}
  ) => {
    const url = apiBase + apiPath;
    const response =
      options.method === 'PUT'
        ? await request.put(url, { data: body })
        : body === undefined
          ? await request.get(url)
          : await request.post(url, { data: body });
    expect(
      response.status(),
      `${apiPath}: ${(await response.text()).slice(0, 400)}`
    ).toBe(options.expected ?? 200);
    return response.json();
  };

  // Admission is durable before the run's row exists: a 404 is still queued.
  const instance = async (run: string) => {
    const response = await request.get(`${apiBase}/workflows/instances/${run}`);
    if (response.status() === 404) return { status: 'queued' };
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const waitFor = async (run: string, status: string) => {
    await expect
      .poll(async () => (await instance(run)).status, {
        timeout: 150_000,
        intervals: [1000],
        message: `run ${run} to be ${status}`,
      })
      .toBe(status);
    return instance(run);
  };

  const name = `[E2E test] Operations ${randomUUID().slice(0, 8)}`;
  const workflow: string = (
    await api('/workflows/create', {
      name,
      description: 'Operations live acceptance test',
    })
  ).data.id;

  const graph = {
    name,
    entryPoint: 'publish',
    inputSchema: { order: { type: 'string' }, amount: { type: 'number' } },
    stateSchema: {
      order: { type: 'string', label: 'Order' },
      amount: { type: 'number', label: 'Amount' },
      stage: {
        type: 'string',
        enum: ['approval', 'approve', 'reject'],
        label: 'Stage',
      },
      dueAt: { type: 'string', format: 'datetime', label: 'Due' },
    },
    steps: {
      publish: {
        id: 'publish',
        stepType: 'SetState',
        values: {
          order: reference('data.order'),
          amount: reference('data.amount'),
          stage: immediate('approval'),
          dueAt: immediate('2026-09-28T10:00:00Z'),
        },
      },
      review: {
        id: 'review',
        name: 'Review orders',
        stepType: 'WaitForSignal',
        action: {
          key: 'approval',
          context: { amount: reference('data.amount') },
        },
        responseSchema: {
          decision: {
            type: 'string',
            enum: ['approve', 'reject'],
            required: true,
          },
          reason: {
            type: 'string',
            label: 'Reason',
            min: 3,
            pattern: '^[A-Za-z ]+$',
            requiredWhen: { field: 'decision', equals: 'reject' },
          },
        },
      },
      record: {
        id: 'record',
        stepType: 'SetState',
        values: { stage: reference('steps.review.outputs.decision') },
      },
      finish: {
        id: 'finish',
        stepType: 'Finish',
        inputMapping: {
          decision: reference('steps.review.outputs.decision'),
        },
      },
    },
    executionPlan: [
      ['publish', 'review'],
      ['review', 'record'],
      ['record', 'finish'],
    ].map(([fromStep, toStep]) => ({ fromStep, toStep })),
  };

  const saveAndCompile = async (definition: unknown, id = workflow) => {
    await api(`/workflows/${id}/update`, { executionGraph: definition });
    const versions: { version?: number; versionNumber?: number }[] = (
      await api(`/workflows/${id}/versions`)
    ).data;
    const version = Math.max(
      ...versions.map((v) => v.version ?? v.versionNumber ?? 0)
    );
    await api(`/workflows/${id}/versions/${version}/compile`, {});
    return version;
  };

  await saveAndCompile(graph);

  const start = async (label: string, amount: number) => {
    const run: string = (
      await api(`/workflows/${workflow}/execute`, {
        runLabel: label,
        inputs: { data: { order: label, amount }, variables: {} },
      })
    ).data.instanceId;
    await waitFor(run, 'suspended');
    return run;
  };
  const runs = [
    await start('ORDER-123', 48200),
    await start('ORDER-2', 2),
    await start('ORDER-10', 10),
  ];

  const openRequests = async (actionKey = 'approval') =>
    (
      await api('/operations/requests/query', {
        workflowId: workflow,
        actionKey,
        query: {},
      })
    ).data;

  // Answer the first run, so two requests stay open and one run has ended.
  const first = (await openRequests()).content.find(
    (r: { instanceId: string }) => r.instanceId === runs[0]
  );
  await api(`/signals/${runs[0]}`, {
    requestId: first.requestId,
    operationId: randomUUID(),
    payload: { decision: 'reject', reason: 'Needs review' },
  });
  await waitFor(runs[0], 'completed');
  expect((await openRequests()).totalElements).toBe(2);

  // A saved queue over the open requests, edited once.
  const configuration = {
    name,
    workflow,
    columns: ['order', 'amount', 'dueAt'],
    where: { openRequest: 'approval', state: [] },
    roles: { key: 'order', stage: 'stage', due: 'dueAt' },
    answers: { inline: 'decision', bulk: true },
    formats: { amount: { kind: 'number', decimals: 2, prefix: '$' } },
  };
  const view = (
    await api('/operations/views', { configuration }, { expected: 201 })
  ).data;
  await api(
    `/operations/views/${view.id}`,
    {
      configuration: { ...configuration, name: `${name} shared` },
      revision: view.revision,
    },
    { method: 'PUT' }
  );

  // A new version whose action has another key: older work stays reachable.
  const newGraph = structuredClone(graph);
  newGraph.steps.review.action.key = 'new_approval';
  newGraph.steps.review.responseSchema.reason.min = 8;
  await saveAndCompile(newGraph);
  const replay: string = (
    await api(`/workflows/instances/${runs[0]}/replay`, {})
  ).data.instanceId;
  await waitFor(replay, 'suspended');

  // A run that fails with a structured error, for Runs and its Replay.
  const failureWorkflow: string = (
    await api('/workflows/create', {
      name: `${name} failure`,
      description: 'Runs Replay acceptance',
    })
  ).data.id;
  await saveAndCompile(
    {
      name: `${name} failure`,
      entryPoint: 'fail',
      steps: {
        fail: {
          id: 'fail',
          stepType: 'Error',
          code: 'TEMPORARY_FAILURE',
          message: 'Intentional E2E failure to verify Replay',
          category: 'transient',
          severity: 'warning',
        },
      },
      executionPlan: [],
    },
    failureWorkflow
  );
  const failureLabel = `RETRY-${randomUUID().slice(0, 8)}`;
  const failureRun: string = (
    await api(`/workflows/${failureWorkflow}/execute`, {
      runLabel: failureLabel,
      inputs: { data: {}, variables: {} },
    })
  ).data.instanceId;
  await waitFor(failureRun, 'failed');

  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        failureWorkflow,
        failureRun,
        failureLabel,
        workflow,
        runs,
        replay,
        view: view.id,
        baseUrl: apiBase.replace(/\/api\/runtime$/, ''),
      },
      null,
      2
    )}\n`
  );
});

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { appPath } from '../utils/app-path';

// Run after e2e/test_operations.py against the same isolated local server.
const fixtureFile = process.env.E2E_OPERATIONS_FIXTURE;
test('Operations: edit separate bulk answers in place, resume runs, and inspect state', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !fixtureFile,
    'Set E2E_OPERATIONS_FIXTURE to the live acceptance fixture JSON'
  );
  const fixture = JSON.parse(readFileSync(fixtureFile!, 'utf8')) as {
    workflow: string;
    runs: string[];
    view: string;
    baseUrl: string;
    replay: string;
    failureWorkflow: string;
    failureRun: string;
    failureLabel: string;
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(appPath('/operations'));
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('overview.png'),
    fullPage: true,
  });
  await page.goto(appPath(`/operations/views/${fixture.view}`));
  const first = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'ORDER-2', exact: true }) });
  const second = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'ORDER-10', exact: true }) });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(first.getByText('$2.00', { exact: true })).toBeVisible();
  await first.getByRole('checkbox').check();
  await second.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Reject 2', exact: true }).click();
  // A bulk answer asks once before it acts on every selected row.
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(first.getByLabel('Reason', { exact: false })).toBeVisible();
  await expect(second.getByLabel('Reason', { exact: false })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await first.getByLabel('Reason', { exact: false }).fill('First review');
  await second.getByLabel('Reason', { exact: false }).fill('x');
  await page.screenshot({
    path: testInfo.outputPath('bulk-answers.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Send filled-in answers', exact: true })
    .click();
  await expect(first.getByText('Answered', { exact: true })).toBeVisible();
  await expect(second.getByText('Answered', { exact: true })).toHaveCount(0);
  await second.getByLabel('Reason', { exact: false }).fill('Second review');
  await second
    .getByRole('button', { name: 'Send answer', exact: true })
    .click();
  await expect(second.getByText('Answered', { exact: true })).toBeVisible();
  for (const id of fixture.runs.slice(1)) {
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `${fixture.baseUrl}/api/runtime/workflows/instances/${id}`
              )
            ).json()
          ).data.status,
        { timeout: 45_000 }
      )
      .toBe('completed');
  }
  await page.goto(
    appPath(`/operations/runs/${fixture.workflow}/${fixture.runs[1]}`)
  );
  await expect(
    page.getByRole('heading', { name: 'ORDER-2', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'State', exact: true })
  ).toBeVisible();
  // A finished run has no request box at all.
  await expect(page.getByText('Open request', { exact: false })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('run.png'),
    fullPage: true,
  });
  // Approval needs no extra input, even when rejection requires a reason.
  await page.goto(
    appPath(`/operations/queues/${fixture.workflow}/new_approval`)
  );
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  // A one-click answer can be undone for a few seconds, then it is sent.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByText('Answered', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto(
    appPath(
      `/operations/runs?status=failed,timeout&workflowId=${fixture.failureWorkflow}`
    )
  );
  await expect(
    page.getByRole('heading', { name: 'Runs', exact: true })
  ).toBeVisible();
  const failed = page.getByRole('row').filter({
    has: page.getByRole('button', {
      name: `Copy run ID ${fixture.failureRun}`,
      exact: true,
    }),
  });
  await expect(
    failed.getByText('Intentional E2E failure to verify Replay', {
      exact: true,
    })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('runs.png'),
    fullPage: true,
  });
  await failed.getByRole('button', { name: 'Replay', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm Replay', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/operations/runs/${fixture.failureWorkflow}/`)
  );
  expect(page.url()).not.toContain(fixture.failureRun);
  await expect(
    page.getByRole('heading', { name: fixture.failureLabel, exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

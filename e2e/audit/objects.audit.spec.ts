import { expect, type Page, type Route } from '@playwright/test';
import {
  test,
  buildInstance,
  buildObjectModelConnection,
  buildSchema,
} from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { json } from './helpers';

const SCHEMA_ID = 'sch_1';
const DEFAULT_CONN = 'conn_object_model_default';

type Props = Record<string, unknown>;
type Captured = { path: string; connectionId: string | null; body: any };
type Op =
  | 'put'
  | 'create'
  | 'bulkDelete'
  | 'bulkInsert'
  | 'filter'
  | 'schemaGet'
  | 'schemaPut';

const schemaWith = (columns: string[], description = '') =>
  buildSchema({
    id: SCHEMA_ID,
    name: 'Customers',
    tableName: 'customers',
    description,
    columns: columns.map((name) => ({ name, type: 'string' })) as never,
  });

const row = (id: string, properties: Props) =>
  buildInstance(SCHEMA_ID, { id, schemaName: 'Customers', properties });

type Db = {
  schema: ReturnType<typeof schemaWith>;
  rows: ReturnType<typeof row>[];
};

/**
 * One stateful handler for every `/object-model/` request, so a single place
 * records bodies and holds or fails responses. Registered after bootstrap.
 */
async function mockObjects(page: Page, dbs: Record<string, Db>) {
  const requests: Record<Op, Captured[]> = {
    put: [],
    create: [],
    bulkDelete: [],
    bulkInsert: [],
    filter: [],
    schemaGet: [],
    schemaPut: [],
  };
  const holds = new Map<Op, Promise<void>>();
  const failing = new Map<Op, (c: Captured) => boolean>();
  let nextId = 1000;

  const wait = async (op: Op) => {
    const held = holds.get(op);
    if (held) await held;
  };
  const fails = (op: Op, c: Captured) => failing.get(op)?.(c) ?? false;

  const ctl = {
    requests,
    dbs,
    /** Hold responses for `op` open until the returned function is called. */
    hold(op: Op) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.set(op, promise);
      return () => {
        holds.delete(op);
        release();
      };
    },
    fail(op: Op, when: (c: Captured) => boolean = () => true) {
      failing.set(op, when);
    },
  };

  await page.route(/\/object-model\//, async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.split('/object-model/')[1];
    const connectionId = url.searchParams.get('connectionId');
    const db = dbs[connectionId ?? ''] ?? Object.values(dbs)[0];
    const captured = (): Captured => ({
      path,
      connectionId,
      body: request.postData() ? request.postDataJSON() : null,
    });

    if (path === 'schemas' && method === 'GET') {
      return json(route, { schemas: [db.schema], totalCount: 1 });
    }
    if (path.startsWith('schemas/') && method === 'GET') {
      requests.schemaGet.push(captured());
      return json(route, { schema: db.schema, success: true });
    }
    if (path.startsWith('schemas/') && method === 'PUT') {
      requests.schemaPut.push(captured());
      await wait('schemaPut');
      return json(route, { success: true });
    }

    if (/^instances\/schema\/[^/]+\/filter$/.test(path)) {
      const c = captured();
      requests.filter.push(c);
      await wait('filter');
      const { offset = 0, limit = 20, condition } = c.body ?? {};
      const matching = db.rows.filter((r) =>
        condition?.op === 'EQ'
          ? (r.properties as Props)[condition.arguments[0]] ===
            condition.arguments[1]
          : true
      );
      return json(route, {
        instances: matching.slice(offset, offset + limit),
        totalCount: matching.length,
      });
    }

    if (path === 'instances' && method === 'POST') {
      const c = captured();
      requests.create.push(c);
      await wait('create');
      if (fails('create', c)) return json(route, { message: 'nope' }, 500);
      nextId += 1;
      const id = `new_${nextId}`;
      db.rows.push(row(id, c.body.properties));
      return json(route, { success: true, instanceId: id });
    }

    if (/^instances\/[^/]+\/bulk$/.test(path)) {
      const c = captured();
      if (method === 'DELETE') {
        requests.bulkDelete.push(c);
        await wait('bulkDelete');
        if (fails('bulkDelete', c)) {
          return json(route, { message: 'delete refused' }, 500);
        }
        const ids: string[] = c.body.instanceIds;
        db.rows = db.rows.filter((r) => !ids.includes(r.id!));
        return json(route, { success: true, deletedCount: ids.length });
      }
      requests.bulkInsert.push(c);
      await wait('bulkInsert');
      return json(route, {
        success: true,
        createdCount: c.body.instances.length,
        skippedCount: 0,
        errors: [],
      });
    }

    const single = /^instances\/[^/]+\/([^/]+)$/.exec(path);
    if (single) {
      const target = db.rows.find((r) => r.id === single[1]);
      if (method === 'PUT') {
        const c = captured();
        requests.put.push(c);
        await wait('put');
        if (fails('put', c)) return json(route, { message: 'rejected' }, 500);
        if (target) {
          target.properties = { ...target.properties, ...c.body.properties };
        }
        return json(route, { success: true });
      }
      return json(route, { instance: target, success: true });
    }
    return json(route, {});
  });
  return ctl;
}

type Backend = Awaited<ReturnType<typeof mockObjects>>;

async function openRecords(
  page: Page,
  mockApi: MockApi,
  rows: ReturnType<typeof row>[]
): Promise<Backend> {
  await mockApi.bootstrap(page);
  const backend = await mockObjects(page, {
    [DEFAULT_CONN]: { schema: schemaWith(['name', 'city']), rows },
  });
  await page.goto('/objects/Customers');
  await expect(rowAt(page, 0)).toBeVisible({ timeout: 15_000 });
  return backend;
}

const rowAt = (page: Page, i: number) => page.locator('tbody tr').nth(i);
const allRows = (page: Page) => page.locator('tbody tr');
// select | id | created | updated | name | city
const NAME = 4;
const cell = (page: Page, r: number, col = NAME) =>
  rowAt(page, r).locator('td').nth(col);
const cellInput = (page: Page, r: number, col = NAME) =>
  cell(page, r, col).locator('input');

async function typeInto(page: Page, r: number, text: string, col = NAME) {
  const input = cellInput(page, r, col);
  if ((await input.count()) === 0) {
    await cell(page, r, col).locator('div.cursor-text').click();
    // Opening the editor removes the clicked node before the document mousedown
    // listener runs, so that listener counts the click as outside the grid and
    // queues a flush 100 ms later. Wait it out as a person would: filling sooner
    // would make that flush send the text, a second request no user would cause.
    await page.waitForTimeout(250);
  }
  await expect(input).toBeVisible();
  await input.fill(text);
}

/** Clicks the footer: inside the shell, outside the `<table>`, not a control. */
const clickAway = (page: Page) =>
  page.getByText(/^[\d,]+ records?( \(\+\d+ drafts?\))?$/).click();
const addRow = (page: Page) =>
  page.getByRole('button', { name: /add.*row/i }).click();
const draftFooter = (page: Page, n: number) =>
  page.getByText(new RegExp(`\\(\\+${n} drafts?\\)$`));
const selectionCount = (page: Page) =>
  page.locator('span:has(> b)').filter({ hasText: 'selected' });
const settle = (page: Page) => page.waitForTimeout(800);

test.describe('Objects audit', () => {
  test('OB-1 A second flush of an in-flight draft creates a duplicate record', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'existing' }),
    ]);
    const release = backend.hold('create');

    await addRow(page);
    await expect(draftFooter(page, 1)).toBeVisible();
    await typeInto(page, 1, 'Ann');
    await cellInput(page, 1).press('Enter');
    await expect.poll(() => backend.requests.create.length).toBe(1);

    // The first POST is still open; the draft is still dirty.
    await clickAway(page);
    await expect.poll(() => backend.requests.create.length).toBe(2);
    expect(backend.requests.create[1].body).toEqual(
      backend.requests.create[0].body
    );

    release();
    await expect(allRows(page).filter({ hasText: 'Ann' })).toHaveCount(2);
    expect(
      backend.dbs[DEFAULT_CONN].rows.filter(
        (r) => (r.properties as Props).name === 'Ann'
      )
    ).toHaveLength(2);
  });

  test('OB-2 Edits typed during an in-flight save are lost when it succeeds', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);
    const release = backend.hold('put');

    await typeInto(page, 0, 'A');
    await cellInput(page, 0).press('Enter');
    await expect.poll(() => backend.requests.put.length).toBe(1);
    await expect(cellInput(page, 0)).toHaveCount(0);

    // Keep typing in the same cell while the PUT is open.
    await typeInto(page, 0, 'AB');
    await expect(cellInput(page, 0)).toHaveValue('AB');
    // Reopening the cell counts as an outside click (see typeInto), so a second
    // PUT of 'A' is already queued behind the hold; 'AB' is in neither.
    expect(backend.requests.put.map((p) => p.body.properties.name)).toEqual([
      'A',
      'A',
    ]);
    release();
    await expect
      .poll(() => (backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name)
      .toBe('A');
    // The success rebuilds the cell, wiping the text from the open editor too.
    await expect(cellInput(page, 0)).toHaveValue('A');

    // Every flush gesture afterwards finds nothing to send.
    await clickAway(page);
    await settle(page);
    await clickAway(page);
    await settle(page);
    expect(backend.requests.put.map((p) => p.body.properties.name)).toEqual([
      'A',
      'A',
    ]);

    await page.reload();
    await expect(cell(page, 0)).toHaveText('A', { timeout: 15_000 });
  });

  test('OB-3 A failed save shows the rejected value with only a toast', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);
    backend.fail('put');
    const filtersBefore = backend.requests.filter.length;

    await typeInto(page, 0, 'rejected');
    await cellInput(page, 0).press('Enter');
    await expect.poll(() => backend.requests.put.length).toBe(1);
    const toast = page.getByText('Failed to update record');
    await expect(toast).toBeVisible();
    await expect(cell(page, 0)).toHaveText('rejected');

    // The rollback refetch did return the server value, and is overlaid.
    await expect
      .poll(() => backend.requests.filter.length)
      .toBeGreaterThan(filtersBefore);
    expect((backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name).toBe(
      'old'
    );

    // Once the toast expires nothing on screen says the value is not saved.
    await page.mouse.move(0, 0);
    await expect(toast).toHaveCount(0, { timeout: 20_000 });
    await expect(cell(page, 0)).toHaveText('rejected');
    await expect(
      rowAt(page, 0).locator(
        '[aria-invalid="true"], [class*="destructive"], [class*="error"], [role="alert"]'
      )
    ).toHaveCount(0);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });

  test('OB-4 A failed row is re-sent on every later outside click', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);
    backend.fail('put');

    await typeInto(page, 0, 'rejected');
    await cellInput(page, 0).press('Enter');
    await expect.poll(() => backend.requests.put.length).toBe(1);
    await expect(page.getByText('Failed to update record')).toBeVisible();

    for (let clicks = 1; clicks <= 3; clicks += 1) {
      await clickAway(page);
      await expect.poll(() => backend.requests.put.length).toBe(1 + clicks);
    }
    await settle(page);
    expect(backend.requests.put).toHaveLength(4);
    expect(
      backend.requests.put.every((p) => p.body.properties.name === 'rejected')
    ).toBe(true);
  });

  test('OB-5 A failed bulk delete loses unsaved edits on rows that still exist', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
      row('r2', { name: 'other' }),
    ]);
    backend.fail('bulkDelete');

    await typeInto(page, 0, 'unsaved');
    // The checkbox is inside the grid, so this does not flush.
    const box = rowAt(page, 0).getByRole('checkbox', { name: 'Select row' });
    await box.click();
    await expect(selectionCount(page)).toHaveText('1 selected');
    await expect(cellInput(page, 0)).toHaveValue('unsaved');

    // The keyboard route opens the dialog without an outside click either.
    await box.press('Delete');
    await expect(page.getByText('Confirm Bulk Delete')).toBeVisible();
    expect(backend.requests.put).toHaveLength(0);

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    await expect(
      page.getByText('Unable to delete selected records')
    ).toBeVisible();

    // The row survived the failure; the edit did not.
    await expect(cell(page, 0)).toHaveText('old');
    await clickAway(page);
    await settle(page);
    expect(backend.requests.put).toHaveLength(0);
  });

  test('OB-6 Select-all includes drafts, whose PENDING_ ids reach bulk delete', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
      row('r2', { name: 'two' }),
    ]);

    await addRow(page);
    await expect(draftFooter(page, 1)).toBeVisible();
    await expect(
      rowAt(page, 2).getByRole('checkbox', { name: 'Select row' })
    ).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Select all' }).click();
    await expect(selectionCount(page)).toHaveText('3 selected');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    const ids: string[] = backend.requests.bulkDelete[0].body.instanceIds;
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(ids.filter((id) => id.startsWith('PENDING_'))).toHaveLength(1);
  });

  test('OB-7 A draft cannot be discarded', async ({ page, mockApi }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
    ]);

    await addRow(page);
    const draft = allRows(page).filter({ hasText: 'Draft' });
    await expect(draft).toHaveCount(1);

    // No control on the row, and not one of the gestures removes it.
    await expect(draft.getByRole('button')).toHaveCount(0);
    await expect(draft.getByRole('checkbox')).toHaveCount(0);
    await cell(page, 1).locator('div.cursor-text').click();
    await cellInput(page, 1).press('Escape');
    await clickAway(page);
    await settle(page);
    await expect(draft).toHaveCount(1);

    // Even a successful select-all delete that names the draft leaves it.
    await page.getByRole('checkbox', { name: 'Select all' }).click();
    await expect(selectionCount(page)).toHaveText('2 selected');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    await expect(allRows(page).filter({ hasText: 'one' })).toHaveCount(0);
    await expect(draft).toHaveCount(1);
    await expect(draftFooter(page, 1)).toBeVisible();
    expect(backend.requests.create).toHaveLength(0);
  });

  test('OB-8 DENIED: Escape keeps the typed value as dirty, and a later flush PUTs that, not the original', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);

    await cell(page, 0).locator('div.cursor-text').click();
    await page.waitForTimeout(250);
    await expect(cellInput(page, 0)).toBeFocused();
    await cellInput(page, 0).evaluate((el) => {
      (el as HTMLInputElement & { auditMark?: boolean }).auditMark = true;
    });
    await page.keyboard.type('typed', { delay: 40 });
    await expect(cellInput(page, 0)).toHaveValue('oldtyped');
    // A keystroke replaces the input element, which resets the cell's refs:
    // the "original" Escape restores is by then the typed text.
    expect(
      await cellInput(page, 0).evaluate(
        (el) => (el as HTMLInputElement & { auditMark?: boolean }).auditMark
      )
    ).toBeUndefined();

    await cellInput(page, 0).press('Escape');
    await expect(cellInput(page, 0)).toHaveCount(0);
    await expect(cell(page, 0)).toHaveText('oldtyped');
    expect(backend.requests.put).toHaveLength(0);

    await clickAway(page);
    await expect.poll(() => backend.requests.put.length).toBe(1);
    expect(backend.requests.put[0].body.properties).toEqual({
      name: 'oldtyped',
    });
  });

  test('OB-9 DENIED: refocusing and pressing Escape after a saved flush keeps the saved value and sends nothing', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);

    await typeInto(page, 0, 'new');
    await clickAway(page);
    await expect.poll(() => backend.requests.put.length).toBe(1);
    await expect
      .poll(() => (backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name)
      .toBe('new');
    // An outside click leaves the editor open: the claimed precondition holds.
    await expect(cellInput(page, 0)).toHaveValue('new');

    await cellInput(page, 0).click();
    await cellInput(page, 0).press('Escape');
    await expect(cellInput(page, 0)).toHaveCount(0);
    await expect(cell(page, 0)).toHaveText('new');

    await clickAway(page);
    await settle(page);
    await clickAway(page);
    await settle(page);
    expect(backend.requests.put).toHaveLength(1);
    expect((backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name).toBe(
      'new'
    );
  });

  test('OB-10 A created record is appended to every cached page regardless of view', async ({
    page,
    mockApi,
  }) => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row(`r${i + 1}`, { name: `n${i + 1}` })
    );
    const backend = await openRecords(page, mockApi, rows);
    await expect(allRows(page)).toHaveCount(20);

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(allRows(page)).toHaveCount(5);

    await addRow(page);
    await typeInto(page, 5, 'NewRec');
    await cellInput(page, 5).press('Enter');
    await expect.poll(() => backend.requests.create.length).toBe(1);
    await expect(draftFooter(page, 1)).toHaveCount(0);

    const filtersBefore = backend.requests.filter.length;
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(allRows(page)).toHaveCount(21);
    await expect(rowAt(page, 20)).toContainText('NewRec');
    await expect(rowAt(page, 0)).toContainText('n1');
    await expect(page.getByText('26 records')).toBeVisible();
    // The record's real position is 26th, which is on page 2.
    expect((backend.dbs[DEFAULT_CONN].rows[25].properties as Props).name).toBe(
      'NewRec'
    );

    // Fresh for the 5-minute staleTime: no refetch comes to correct it.
    await settle(page);
    expect(backend.requests.filter).toHaveLength(filtersBefore);
    await expect(allRows(page)).toHaveCount(21);
  });

  test('OB-11 Row selection survives filter, sort and page changes', async ({
    page,
    mockApi,
  }) => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row(`r${i + 1}`, { name: `n${i + 1}` })
    );
    const backend = await openRecords(page, mockApi, rows);

    await rowAt(page, 0).getByRole('checkbox', { name: 'Select row' }).click();
    await expect(selectionCount(page)).toHaveText('1 selected');

    // Page change: the selected row is off screen.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(rowAt(page, 0)).toContainText('n21');
    await expect(allRows(page).filter({ hasText: /\bn1\b/ })).toHaveCount(0);
    await expect(selectionCount(page)).toHaveText('1 selected');
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(rowAt(page, 0)).toContainText('n1');

    // Sort change.
    const filtersBeforeSort = backend.requests.filter.length;
    await page.getByRole('columnheader', { name: 'Created At' }).click();
    await expect
      .poll(() =>
        backend.requests.filter
          .slice(filtersBeforeSort)
          .some((f) => f.body?.sortBy?.includes('createdAt'))
      )
      .toBe(true);
    await expect(selectionCount(page)).toHaveText('1 selected');

    // Filter change: a real condition that excludes the selected row.
    await page.getByRole('button', { name: /Filter records/ }).click();
    await page.getByRole('button', { name: 'Add Filter Condition' }).click();
    await page.getByText('Select field...').click();
    await page.getByRole('option', { name: /^name/ }).click();
    await page.getByPlaceholder('Value').fill('n7');
    await expect
      .poll(() =>
        backend.requests.filter.some(
          (f) => f.body?.condition?.arguments?.[1] === 'n7'
        )
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(allRows(page)).toHaveCount(1);
    await expect(rowAt(page, 0)).toContainText('n7');
    await expect(selectionCount(page)).toHaveText('1 selected');

    // And the invisible row is what a delete would target.
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    expect(backend.requests.bulkDelete[0].body.instanceIds).toEqual(['r1']);
  });

  test('OB-12 PARTIAL: back, forward and reload give no warning or flush, a clicked link does flush', async ({
    page,
    mockApi,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.accept();
    });
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);
    const link = page.getByRole('link', { name: /connections/i }).first();

    // A history entry to go forward to, created while nothing is dirty.
    await link.click();
    await expect(page).toHaveURL(/\/connections/);
    await page.goBack();
    await expect(page).toHaveURL(/\/objects\/Customers/);
    await expect(cell(page, 0)).toHaveText('old', { timeout: 15_000 });

    // SPA navigation with no pointer event: unsaved row dropped silently.
    await typeInto(page, 0, 'unsaved-forward');
    await page.goForward();
    await expect(page).toHaveURL(/\/connections/);
    await settle(page);
    expect(backend.requests.put).toHaveLength(0);
    await page.goBack();
    await expect(cell(page, 0)).toHaveText('old', { timeout: 15_000 });

    // Full reload: no beforeunload prompt, no request.
    await typeInto(page, 0, 'unsaved-reload');
    await page.reload();
    await expect(cell(page, 0)).toHaveText('old', { timeout: 15_000 });
    expect(backend.requests.put).toHaveLength(0);
    expect(dialogs).toEqual([]);

    // A clicked link: its mousedown counts as an outside click and the
    // deferred flush still runs after the page has unmounted.
    await typeInto(page, 0, 'unsaved-link');
    await link.click();
    await expect(page).toHaveURL(/\/connections/);
    await expect.poll(() => backend.requests.put.length).toBe(1);
    expect(backend.requests.put[0].body.properties).toEqual({
      name: 'unsaved-link',
    });
    expect(dialogs).toEqual([]);
  });

  test('OB-13 Dirty rows and drafts carry over when the connection changes', async ({
    page,
    mockApi,
  }) => {
    const A = 'conn_primary';
    const B = 'conn_archive';
    await mockApi.bootstrap(page);
    await mockApi.connections.list(page, [
      buildObjectModelConnection({
        id: A,
        title: 'Primary database',
        defaultFor: ['object_model'],
      }),
      buildObjectModelConnection({
        id: B,
        title: 'Archive database',
        defaultFor: [],
      }),
    ]);
    // Same row id on both: the shape of a copied or restored database.
    const backend = await mockObjects(page, {
      [A]: {
        schema: schemaWith(['name', 'city']),
        rows: [row('r1', { name: 'alpha' })],
      },
      [B]: {
        schema: schemaWith(['name', 'city']),
        rows: [row('r1', { name: 'bravo' })],
      },
    });
    const switchTo = async (title: RegExp, id: string) => {
      await page.getByRole('button', { name: 'Database connection' }).click();
      await page.getByRole('option', { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`connectionId=${id}`));
    };

    await page.goto('/objects/Customers');
    await expect(cell(page, 0)).toHaveText('alpha', { timeout: 15_000 });

    expect((backend.dbs[B].rows[0].properties as Props).name).toBe('bravo');
    backend.fail('put', (c) => c.connectionId === A);
    await addRow(page);
    await expect(draftFooter(page, 1)).toBeVisible();
    await typeInto(page, 0, 'edit-on-A');
    await cellInput(page, 0).press('Enter');
    await expect.poll(() => backend.requests.put.length).toBe(1);
    expect(backend.requests.put[0].connectionId).toBe(A);
    await expect(
      page.getByText('Failed to update record').first()
    ).toBeVisible();

    const filtersBefore = backend.requests.filter.length;
    await switchTo(/Archive/, B);
    // B's rows really were requested.
    await expect
      .poll(() =>
        backend.requests.filter
          .slice(filtersBefore)
          .some((f) => f.connectionId === B)
      )
      .toBe(true);
    await settle(page);

    // Choosing B is itself an outside click. Its deferred flush runs after the
    // switch, and the mutation by then targets B: A's edit is written into B,
    // with no further gesture.
    await expect
      .poll(() => backend.requests.put.filter((p) => p.connectionId === B))
      .toHaveLength(1);
    const leaked = backend.requests.put.find((p) => p.connectionId === B)!;
    console.log(
      `OB-13: PUTs ${backend.requests.put.map((p) => p.connectionId).join(', ')}`
    );
    expect(leaked.body.properties).toEqual({ name: 'edit-on-A' });
    await expect(cell(page, 0)).toHaveText('edit-on-A');
    // A's draft is still here, on B's table.
    await expect(draftFooter(page, 1)).toBeVisible();
    await expect
      .poll(() => (backend.dbs[B].rows[0].properties as Props).name)
      .toBe('edit-on-A');
  });

  const bulkInsertButton = (page: Page) =>
    page.getByRole('button', { name: 'Bulk insert' });
  const records = (page: Page) => page.getByLabel('Records (JSON array)');
  const insertTitle = (page: Page) => page.getByText('Bulk Insert (JSON)');
  const insertButton = (page: Page) =>
    page.getByRole('button', { name: 'Insert', exact: true });

  test('OB-14 Bulk insert: closing during submit shows a stale result on reopen', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
    ]);
    const release = backend.hold('bulkInsert');

    await bulkInsertButton(page).click();
    await records(page).fill('[{"name":"x"}]');
    await insertButton(page).click();
    await expect.poll(() => backend.requests.bulkInsert.length).toBe(1);
    await expect(
      page.getByRole('button', { name: 'Inserting…' })
    ).toBeDisabled();

    // Close is disabled while submitting, Escape is not.
    await page.keyboard.press('Escape');
    await expect(insertTitle(page)).toHaveCount(0);
    release();
    await expect(page.getByText('Inserted 1, skipped 0')).toBeVisible();

    await bulkInsertButton(page).click();
    await expect(insertTitle(page)).toBeVisible();
    await expect(records(page)).toHaveValue('');
    await expect(page.getByRole('dialog')).toContainText(
      '1 created, 0 skipped'
    );
  });

  test('OB-15 Bulk insert: Insert stays enabled after success and re-inserts the same payload', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
    ]);

    await bulkInsertButton(page).click();
    await records(page).fill('[{"name":"x"}]');
    await insertButton(page).click();
    await expect(page.getByRole('dialog')).toContainText(
      '1 created, 0 skipped'
    );
    expect(backend.requests.bulkInsert).toHaveLength(1);

    await expect(insertButton(page)).toBeEnabled();
    await expect(records(page)).toHaveValue('[{"name":"x"}]');
    await insertButton(page).click();
    await expect.poll(() => backend.requests.bulkInsert.length).toBe(2);
    expect(backend.requests.bulkInsert[1].body).toEqual(
      backend.requests.bulkInsert[0].body
    );
  });

  test('OB-16 Bulk insert: hidden conflict columns are still sent', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
    ]);

    await bulkInsertButton(page).click();
    await records(page).fill('[{"name":"x"}]');
    await page.getByLabel('On conflict').click();
    await page.getByRole('option', { name: 'Skip existing' }).click();
    const column = page
      .getByRole('dialog')
      .getByRole('checkbox', { name: 'name' });
    await column.click();
    await expect(column).toBeChecked();

    await page.getByLabel('On conflict').click();
    await page.getByRole('option', { name: 'Error on conflict' }).click();
    await expect(column).toHaveCount(0);

    await insertButton(page).click();
    await expect.poll(() => backend.requests.bulkInsert.length).toBe(1);
    expect(backend.requests.bulkInsert[0].body.onConflict).toBe('error');
    expect(backend.requests.bulkInsert[0].body.conflictColumns).toEqual([
      'name',
    ]);
  });

  test('OB-17 Schema form: name edits overwrite a manually typed table name', async ({
    page,
    mockApi,
  }) => {
    await mockApi.bootstrap(page);
    await mockObjects(page, {
      [DEFAULT_CONN]: { schema: schemaWith(['name']), rows: [] },
    });
    await page.goto('/objects/types/create');

    const name = page.locator('#name');
    const table = page.locator('#tableName');
    await expect(name).toBeVisible({ timeout: 15_000 });
    await name.fill('Customer');
    await expect(table).not.toHaveValue('');

    await table.fill('my_custom_table');
    await expect(table).toHaveValue('my_custom_table');

    await name.fill('CustomerV2');
    await expect(table).not.toHaveValue('my_custom_table');
    await expect(table).toHaveValue(/customer/i);
  });

  test('OB-18 Schema form keeps old fields across a connection switch', async ({
    page,
    mockApi,
  }) => {
    const A = 'conn_primary';
    const B = 'conn_archive';
    await mockApi.bootstrap(page);
    await mockApi.connections.list(page, [
      buildObjectModelConnection({
        id: A,
        title: 'Primary database',
        defaultFor: ['object_model'],
      }),
      buildObjectModelConnection({
        id: B,
        title: 'Archive database',
        defaultFor: [],
      }),
    ]);
    const backend = await mockObjects(page, {
      [A]: { schema: schemaWith(['alpha_col'], 'desc A'), rows: [] },
      [B]: { schema: schemaWith(['bravo_col'], 'desc B'), rows: [] },
    });
    const switchTo = async (title: RegExp, id: string) => {
      await page.getByRole('button', { name: 'Database connection' }).click();
      await page.getByRole('option', { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`connectionId=${id}`));
    };
    const column = page.getByPlaceholder('column_name');
    const description = page.locator('#description');

    await page.goto(`/objects/types/${SCHEMA_ID}`);
    await expect(column).toHaveValue('alpha_col', { timeout: 15_000 });
    await expect(description).toHaveValue('desc A');

    // B is not cached. keepPreviousData skips the spinner anyway, so the form
    // is never remounted, even though B's schema has been fetched.
    const loads = () =>
      backend.requests.schemaGet.filter((g) => g.connectionId === B).length;
    expect(loads()).toBe(0);
    await switchTo(/Archive/, B);
    await expect.poll(loads).toBe(1);
    await settle(page);
    await expect(column).toHaveValue('alpha_col');
    await expect(description).toHaveValue('desc A');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => backend.requests.schemaPut.length).toBe(1);
    const put = backend.requests.schemaPut[0];
    expect(put.connectionId).toBe(B);
    expect(put.body.columns.map((c: { name: string }) => c.name)).toEqual([
      'alpha_col',
    ]);
    expect(put.body.description).toBe('desc A');
  });
});

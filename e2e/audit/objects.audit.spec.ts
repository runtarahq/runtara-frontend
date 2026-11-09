import { expect, type Page, type Route } from '@playwright/test';
import {
  test,
  buildInstance,
  buildObjectModelConnection,
  buildSchema,
} from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { json, knownDefect } from './helpers';

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
  test('OB-1 A second flush of an in-flight draft does not create a duplicate record', async ({
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
    await settle(page);

    release();
    const saved = () =>
      backend.dbs[DEFAULT_CONN].rows.filter(
        (r) => (r.properties as Props).name === 'Ann'
      );
    await expect.poll(() => saved().length).toBeGreaterThanOrEqual(1);
    await settle(page);

    // Fixed: the second flush waits for the open POST, then finds nothing
    // left to send.
    expect(backend.requests.create).toHaveLength(1);
    expect(saved()).toHaveLength(1);
    await expect(allRows(page).filter({ hasText: 'Ann' })).toHaveCount(1);
  });

  test('OB-2 Edits typed during an in-flight save survive when it succeeds', async ({
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
    // Reopening the cell counts as an outside click (see typeInto). That flush
    // waits for the open PUT rather than sending 'A' again (OB-1).
    expect(backend.requests.put.map((p) => p.body.properties.name)).toEqual([
      'A',
    ]);
    release();
    // Fixed: 'AB' stays dirty after the first PUT succeeds, and the flush that
    // waited sends it with no further gesture.
    await expect
      .poll(() => (backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name)
      .toBe('AB');
    await settle(page);

    // Later flush gestures find nothing left to send.
    await clickAway(page);
    await settle(page);
    expect(backend.requests.put.map((p) => p.body.properties.name)).toEqual([
      'A',
      'AB',
    ]);

    await page.reload();
    await expect(rowAt(page, 0)).toBeVisible({ timeout: 15_000 });
    await expect(cell(page, 0)).toHaveText('AB');
  });

  test('OB-3 A failed save does not leave the rejected value looking saved once the toast is gone', async ({
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

    // The rollback refetch did return the server value, and is overlaid.
    await expect
      .poll(() => backend.requests.filter.length)
      .toBeGreaterThan(filtersBefore);
    expect((backend.dbs[DEFAULT_CONN].rows[0].properties as Props).name).toBe(
      'old'
    );

    // Once the toast expires the screen has to say the value is not saved:
    // the cell shows the server's value, or the rejected one carries a marker.
    await page.mouse.move(0, 0);
    await expect(toast).toHaveCount(0, { timeout: 20_000 });
    await knownDefect('OB-3', async () => {
      await expect
        .poll(async () => {
          const markers =
            (await rowAt(page, 0)
              .locator(
                '[aria-invalid="true"], [class*="destructive"], [class*="error"], [role="alert"]'
              )
              .count()) + (await page.locator('[role="alert"]').count());
          const shown = (await cell(page, 0).textContent())?.trim();
          return shown === 'rejected' && markers === 0
            ? 'rejected value shown with no marker'
            : 'not presented as saved';
        })
        .toBe('not presented as saved');
    });
  });

  test('OB-4 A failed row is not re-sent by later outside clicks', async ({
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
      await settle(page);
    }
    await knownDefect('OB-4', async () => {
      expect(backend.requests.put).toHaveLength(1);
    });
  });

  test('OB-5 A failed bulk delete keeps unsaved edits on rows that still exist', async ({
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
    // Unsaved: the editor closed, but the cell shows the pending edit.
    await expect(cell(page, 0)).toHaveText('unsaved');

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

    // The row survived the failure, so its edit has to reach the server: a
    // flush gesture after the failure is the last chance to send it.
    await settle(page);
    await clickAway(page);
    await settle(page);
    // Fixed: the edit came back with the row, and that flush sends it.
    await expect(cell(page, 0)).toHaveText('unsaved');
    expect(backend.requests.put.map((p) => p.body.properties.name)).toContain(
      'unsaved'
    );
  });

  test('OB-6 Select-all does not send the PENDING_ ids of drafts to bulk delete', async ({
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
    await expect(selectionCount(page)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    const ids: string[] = backend.requests.bulkDelete[0].body.instanceIds;
    expect(ids).toEqual(expect.arrayContaining(['r1', 'r2']));
    await knownDefect('OB-6', async () => {
      expect(ids.filter((id) => id.startsWith('PENDING_'))).toEqual([]);
    });
  });

  test('OB-7 A delete naming a draft discards it', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'one' }),
    ]);

    await addRow(page);
    const draft = allRows(page).filter({ hasText: 'Draft' });
    await expect(draft).toHaveCount(1);

    // A successful select-all delete that names the draft has to remove it.
    await page.getByRole('checkbox', { name: 'Select all' }).click();
    await expect(selectionCount(page)).toHaveText('2 selected');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    const named: string[] = backend.requests.bulkDelete[0].body.instanceIds;
    expect(named.some((id) => id.startsWith('PENDING_'))).toBe(true);
    await expect(allRows(page).filter({ hasText: 'one' })).toHaveCount(0);
    expect(backend.requests.create).toHaveLength(0);
    await settle(page);

    await knownDefect('OB-7', async () => {
      await expect(draft).toHaveCount(0);
      await expect(draftFooter(page, 1)).toHaveCount(0);
    });
  });

  test('OB-8 Escape reverts the cell to its original value, and a later flush does not send the typed text', async ({
    page,
    mockApi,
  }) => {
    const backend = await openRecords(page, mockApi, [
      row('r1', { name: 'old' }),
    ]);

    await cell(page, 0).locator('div.cursor-text').click();
    await page.waitForTimeout(250);
    await expect(cellInput(page, 0)).toBeFocused();
    await page.keyboard.type('typed', { delay: 40 });
    await expect(cellInput(page, 0)).toHaveValue('oldtyped');

    await cellInput(page, 0).press('Escape');
    await expect(cellInput(page, 0)).toHaveCount(0);
    expect(backend.requests.put).toHaveLength(0);

    await expect(cell(page, 0)).toHaveText('old');

    await clickAway(page);
    await settle(page);
    expect(backend.requests.put).toHaveLength(0);
  });

  test('OB-9 Refocusing and pressing Escape after a saved flush keeps the saved value and sends nothing', async ({
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
    // The click away closed the editor, so there is nothing left to revert.
    await expect(cellInput(page, 0)).toHaveCount(0);
    await expect(cell(page, 0)).toHaveText('new');

    // A new edit starts from the saved value, and Escape returns to it.
    await cell(page, 0).locator('div.cursor-text').click();
    await page.waitForTimeout(250);
    await expect(cellInput(page, 0)).toHaveValue('new');
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

  test('OB-10 A created record is not appended to a cached page it does not belong on', async ({
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

    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(rowAt(page, 0)).toContainText('n1');
    await expect(page.getByText('26 records')).toBeVisible();
    // The record's real position is 26th, which is on page 2.
    expect((backend.dbs[DEFAULT_CONN].rows[25].properties as Props).name).toBe(
      'NewRec'
    );

    await settle(page);
    await knownDefect('OB-10', async () => {
      await expect(allRows(page)).toHaveCount(20);
      await expect(allRows(page).filter({ hasText: 'NewRec' })).toHaveCount(0);
    });
  });

  test('OB-11 A delete does not target a selected row that a later filter excludes', async ({
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
    await settle(page);

    // Cross-page selection may be fine; a delete of a row the filter hides is
    // not. A fix may clear the selection, which removes the Delete button.
    const del = page.getByRole('button', { name: 'Delete' });
    if (await del.isVisible()) {
      await del.click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Delete' })
        .click();
      await expect.poll(() => backend.requests.bulkDelete.length).toBe(1);
    }
    await knownDefect('OB-11', async () => {
      expect(
        backend.requests.bulkDelete.flatMap((d) => d.body.instanceIds)
      ).not.toContain('r1');
    });
  });

  test('OB-12 Forward and reload warn about or flush an unsaved row, as a clicked link flushes it', async ({
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
    const putNames = () =>
      backend.requests.put.map((p) => p.body.properties.name as string);
    // Evidence the user's text was kept or the user was told; either will do.
    const warnedOrFlushed = (typed: string, dialogsBefore: number) =>
      expect
        .poll(
          () => [
            ...putNames().filter((name) => name === typed),
            ...dialogs.slice(dialogsBefore),
          ],
          { timeout: 2_000 }
        )
        .not.toEqual([]);

    // A history entry to go forward to, created while nothing is dirty.
    await link.click();
    await expect(page).toHaveURL(/\/connections/);
    await page.goBack();
    await expect(page).toHaveURL(/\/objects\/Customers/);
    await expect(cell(page, 0)).toHaveText('old', { timeout: 15_000 });

    // SPA navigation with no pointer event.
    await typeInto(page, 0, 'unsaved-forward');
    await page.goForward();
    await expect(page).toHaveURL(/\/connections/);
    await settle(page);
    await knownDefect('OB-12', () => warnedOrFlushed('unsaved-forward', 0));
    await page.goBack();
    await expect(rowAt(page, 0)).toBeVisible({ timeout: 15_000 });

    // Full reload.
    const dialogsBeforeReload = dialogs.length;
    await typeInto(page, 0, 'unsaved-reload');
    await page.reload();
    await expect(rowAt(page, 0)).toBeVisible({ timeout: 15_000 });
    await knownDefect('OB-12', () =>
      warnedOrFlushed('unsaved-reload', dialogsBeforeReload)
    );

    // A clicked link: its mousedown counts as an outside click and the
    // deferred flush still runs after the page has unmounted.
    await typeInto(page, 0, 'unsaved-link');
    await link.click();
    await expect(page).toHaveURL(/\/connections/);
    await expect.poll(putNames).toContain('unsaved-link');
  });

  test('OB-13 Dirty rows and drafts do not carry over when the connection changes', async ({
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

    // Choosing B is itself an outside click, and its deferred flush runs after
    // the switch. A's edit must not reach B, nor A's draft stay on B's table.
    await knownDefect('OB-13', async () => {
      expect(
        backend.requests.put
          .filter((p) => p.connectionId === B)
          .map((p) => p.body.properties)
      ).toEqual([]);
      expect((backend.dbs[B].rows[0].properties as Props).name).toBe('bravo');
      await expect(cell(page, 0)).toHaveText('bravo');
      await expect(draftFooter(page, 1)).toHaveCount(0);
    });
  });

  const bulkInsertButton = (page: Page) =>
    page.getByRole('button', { name: 'Bulk insert' });
  const records = (page: Page) => page.getByLabel('Records (JSON array)');
  const insertTitle = (page: Page) => page.getByText('Bulk Insert (JSON)');
  const insertButton = (page: Page) =>
    page.getByRole('button', { name: 'Insert', exact: true });

  test('OB-14 Bulk insert: closing during submit does not show a stale result on reopen', async ({
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
    await settle(page);
    await knownDefect('OB-14', async () => {
      await expect(page.getByRole('dialog')).not.toContainText(
        '1 created, 0 skipped'
      );
    });
  });

  test('OB-15 Bulk insert: Insert after a success does not re-insert the same payload', async ({
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

    // A fix may disable or remove the button; the click is only there if not.
    const again = insertButton(page);
    if ((await again.count()) > 0 && (await again.isEnabled())) {
      await again.click();
    }
    await settle(page);
    await knownDefect('OB-15', async () => {
      expect(backend.requests.bulkInsert).toHaveLength(1);
    });
  });

  test('OB-16 Bulk insert: hidden conflict columns are not sent', async ({
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
    await knownDefect('OB-16', async () => {
      expect(backend.requests.bulkInsert[0].body.conflictColumns ?? []).toEqual(
        []
      );
    });
  });

  test('OB-17 Schema form: name edits keep a manually typed table name', async ({
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
    await expect(name).toHaveValue('CustomerV2');
    // Give the name-to-table sync time to run before reading the result.
    await settle(page);
    await knownDefect('OB-17', async () => {
      await expect(table).toHaveValue('my_custom_table');
    });
  });

  test('OB-18 Schema form loads the new schema across a connection switch', async ({
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

    // B is not cached, and B's schema has to replace A's once it is fetched.
    const loads = () =>
      backend.requests.schemaGet.filter((g) => g.connectionId === B).length;
    expect(loads()).toBe(0);
    await switchTo(/Archive/, B);
    await expect.poll(loads).toBe(1);
    await settle(page);
    const shownColumn = await column.inputValue();
    const shownDescription = await description.inputValue();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => backend.requests.schemaPut.length).toBe(1);
    const put = backend.requests.schemaPut[0];
    expect(put.connectionId).toBe(B);
    expect(put.body.columns.map((c: { name: string }) => c.name)).toEqual([
      'bravo_col',
    ]);
    expect(put.body.description).toBe('desc B');
    expect(shownColumn).toBe('bravo_col');
    expect(shownDescription).toBe('desc B');
  });
});

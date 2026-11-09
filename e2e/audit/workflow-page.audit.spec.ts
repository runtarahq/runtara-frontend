import { execSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { test, buildWorkflow } from '../fixtures';
import { api, json, knownDefect, logWorkflow, openWorkflow } from './helpers';

type Gate = { promise: Promise<void>; release: () => void };

function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * The save endpoint plus a GET that answers with what was last saved, as a real
 * server would. `hold` keeps the update response open until it is released.
 */
async function mockSave(page: Page, wf: ReturnType<typeof buildWorkflow>) {
  const saves: any[] = [];
  const ctl = {
    saves,
    responded: 0,
    hold: null as Gate | null,
  };
  let current: any = wf;
  await page.route(api(`workflows/${wf.id}`), (route) =>
    json(route, { data: current, success: true })
  );
  await page.route(api(`workflows/${wf.id}/update`), async (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    const version = saves.length + 1;
    const pending = ctl.hold;
    if (pending) await pending.promise;
    current = {
      ...current,
      executionGraph: body.executionGraph,
      name: body.executionGraph?.name ?? current.name,
      description: body.executionGraph?.description ?? current.description,
      lastVersionNumber: version,
    };
    ctl.responded += 1;
    await json(route, {
      data: current,
      message: 'ok',
      success: true,
      version: String(version),
    });
  });
  await page.route(
    api(`workflows/${wf.id}/versions/\\d+/compilation-progress`),
    (route) => json(route, { status: 'success' })
  );
  return ctl;
}

const saveEnabled = (page: Page) => page.getByTitle('Save changes');
const saveClean = (page: Page) => page.getByTitle('No changes to save');
const unsavedDialog = (page: Page) =>
  page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({
    hasText: 'Unsaved changes',
  });
const workflowsLink = (page: Page) => page.locator('a[href$="/workflows"]');

/** Adds a note with the given text, committing it with a blur. */
async function addNote(page: Page, text: string) {
  await page.getByTitle('Add note').click();
  const editor = page
    .locator('.react-flow__node-note textarea')
    .or(page.locator('.react-flow__node textarea'));
  await expect(editor.first()).toBeVisible();
  await editor.first().fill(text);
  await page.locator('h1').first().click();
  await expect(page.locator('.react-flow__node').getByText(text)).toBeVisible();
}

test.describe('Workflow page audit: saving', () => {
  test('WF-1 A canvas edit made during a save is still counted as unsaved after the save succeeds', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf1');
    let save!: Awaited<ReturnType<typeof mockSave>>;
    await openWorkflow(page, mockApi, wf, async () => {
      save = await mockSave(page, wf);
    });

    await addNote(page, 'before save');

    // Control: an unsaved edit does guard leaving the page.
    await workflowsLink(page).first().click();
    await expect(unsavedDialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);

    save.hold = gate();
    await saveEnabled(page).click();
    await expect.poll(() => save.saves.length, { timeout: 15_000 }).toBe(1);
    expect(save.responded).toBe(0);

    // "Add note" is disabled while the save is in flight, the note editor is not.
    await expect(page.getByTitle('Add note')).toBeDisabled();
    await page.locator('.react-flow__node').getByText('before save').dblclick();
    await page.locator('.react-flow__node textarea').fill('edited during save');
    await page.locator('h1').first().click();
    await expect(
      page.locator('.react-flow__node').getByText('edited during save')
    ).toBeVisible();

    save.hold.release();
    await expect.poll(() => save.responded).toBe(1);

    // The save has finished: the toolbar reads "Save changes" while it is in
    // flight either way, so an earlier check would prove nothing.
    await expect(page.getByTitle('Add note')).toBeEnabled({ timeout: 10_000 });

    // The save carried the old text and the canvas keeps the new one.
    const sent = JSON.stringify(save.saves[0]);
    expect(sent).toContain('before save');
    expect(sent).not.toContain('edited during save');
    await expect(
      page.locator('.react-flow__node').getByText('edited during save')
    ).toBeVisible();
    expect(save.saves).toHaveLength(1);

    // Fixed: the edit made during the save is still unsaved.
    await expect(saveClean(page)).toHaveCount(0);
    await workflowsLink(page).first().click();
    await expect(unsavedDialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();

    // Saving again sends it, and then the page is clean.
    save.hold = null;
    await saveEnabled(page).click();
    await expect.poll(() => save.responded).toBe(2);
    expect(JSON.stringify(save.saves[1])).toContain('edited during save');
    await expect(saveClean(page)).toBeVisible({ timeout: 10_000 });
  });

  test('WF-2 A settings edit made during a save is still counted as unsaved after the save succeeds', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf2');
    let save!: Awaited<ReturnType<typeof mockSave>>;
    await openWorkflow(page, mockApi, wf, async () => {
      save = await mockSave(page, wf);
    });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const description = page.getByPlaceholder(
      'Describe what this workflow does...'
    );
    await description.fill('first description');
    await expect(saveEnabled(page)).toBeEnabled();

    save.hold = gate();
    await saveEnabled(page).click();
    await expect.poll(() => save.saves.length, { timeout: 15_000 }).toBe(1);
    expect(save.saves[0].executionGraph.description).toBe('first description');

    await description.fill('edited during save');
    await expect(description).toHaveValue('edited during save');

    save.hold.release();
    await expect.poll(() => save.responded).toBe(1);
    // The save has finished: the toolbar reads "Save changes" while it is in
    // flight either way, so an earlier check would prove nothing.
    await expect(page.getByTitle('Add note')).toBeEnabled({ timeout: 10_000 });

    // The edit was never sent.
    expect(JSON.stringify(save.saves)).not.toContain('edited during save');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const shown = await description.inputValue();
    console.log(`WF-2 Description field after save and tab return: "${shown}"`);
    // The page goes on showing the edit.
    expect(shown).toBe('edited during save');
    expect(save.saves).toHaveLength(1);

    await knownDefect('WF-2', async () => {
      await expect(saveClean(page)).toHaveCount(0);
      await workflowsLink(page).first().click();
      await expect(unsavedDialog(page)).toBeVisible();
    });

    // The server has only the first text.
    await page.goto(`/workflows/${wf.id}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(description).toHaveValue('first description');
  });

  test('WF-3 Two clicks during the validation window send one save', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf3');
    let save!: Awaited<ReturnType<typeof mockSave>>;
    await openWorkflow(page, mockApi, wf, async () => {
      save = await mockSave(page, wf);
    });

    const center = async () => {
      const box = (await saveEnabled(page).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const results: Record<string, number> = {};

    // Cold: the first validation also loads the WASM.
    await addNote(page, 'one');
    save.hold = gate();
    await saveEnabled(page).dblclick();
    await expect
      .poll(() => save.saves.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    results.coldDblclick = save.saves.length;
    save.hold.release();
    await expect.poll(() => save.responded).toBe(results.coldDblclick);
    await expect(saveClean(page)).toBeVisible();

    // Warm, with real mouse clicks a given gap apart.
    for (const gapMs of [0, 30, 120, 250]) {
      await addNote(page, `gap ${gapMs}`);
      const before = save.saves.length;
      save.hold = gate();
      const { x, y } = await center();
      await page.mouse.click(x, y);
      if (gapMs) await page.waitForTimeout(gapMs);
      await page.mouse.click(x, y);
      await expect
        .poll(() => save.saves.length, { timeout: 15_000 })
        .toBeGreaterThan(before);
      await page.waitForTimeout(1_000);
      results[`warmGap${gapMs}ms`] = save.saves.length - before;
      save.hold.release();
      await expect.poll(() => save.responded).toBe(save.saves.length);
      await expect(saveClean(page)).toBeVisible();
    }

    // Cold again, at human double-click speed: a reload drops the loaded WASM.
    for (const gapMs of [120, 250]) {
      await page.reload();
      await expect(page.locator('.react-flow__node').first()).toBeVisible({
        timeout: 15_000,
      });
      await addNote(page, `cold ${gapMs}`);
      const before = save.saves.length;
      save.hold = gate();
      const { x, y } = await center();
      await page.mouse.click(x, y);
      await page.waitForTimeout(gapMs);
      await page.mouse.click(x, y);
      await expect
        .poll(() => save.saves.length, { timeout: 15_000 })
        .toBeGreaterThan(before);
      await page.waitForTimeout(1_000);
      results[`coldGap${gapMs}ms`] = save.saves.length - before;
      save.hold.release();
      await expect.poll(() => save.responded).toBe(save.saves.length);
      await expect(saveClean(page)).toBeVisible();
    }

    // Slow network: validation waits for the agent catalog, which holds the
    // window open for as long as that request takes.
    const catalog = gate();
    let catalogRequested = 0;
    await page.route(api('agents'), async (route) => {
      catalogRequested += 1;
      await catalog.promise;
      await json(route, { agents: [] });
    });
    await page.reload();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({
      timeout: 15_000,
    });
    await addNote(page, 'slow catalog');
    const beforeSlow = save.saves.length;
    save.hold = gate();
    const slowAt = await center();
    await page.mouse.click(slowAt.x, slowAt.y);
    await page.waitForTimeout(250);
    await page.mouse.click(slowAt.x, slowAt.y);
    await page.waitForTimeout(500);
    const whileHeld = save.saves.length - beforeSlow;
    catalog.release();
    await expect
      .poll(() => save.saves.length, { timeout: 15_000 })
      .toBeGreaterThan(beforeSlow);
    await page.waitForTimeout(1_000);
    results.slowCatalogGap250ms = save.saves.length - beforeSlow;
    console.log(
      `WF-3 slow catalog: requested ${catalogRequested}, POSTs while held ${whileHeld}, after release ${results.slowCatalogGap250ms}`
    );
    save.hold.release();

    console.log('WF-3 update POSTs per double click', JSON.stringify(results));
    expect(whileHeld).toBe(0);
    await knownDefect('WF-3', async () => {
      expect(results.coldDblclick).toBe(1);
      expect(results.slowCatalogGap250ms).toBe(1);
      expect(JSON.stringify(save.saves[0].executionGraph)).not.toEqual(
        JSON.stringify(save.saves[1].executionGraph)
      );
    });
  });
});

const twoVersions = [
  {
    versionNumber: 2,
    version: 2,
    compiled: true,
    updatedAt: '2026-01-02T12:00:00Z',
    created: '2026-01-02T12:00:00Z',
    trackEvents: false,
  },
  {
    versionNumber: 1,
    version: 1,
    compiled: true,
    updatedAt: '2026-01-01T12:00:00Z',
    created: '2026-01-01T12:00:00Z',
    trackEvents: false,
  },
];

/** Compilation endpoints: a per-version poll log and a swappable answer. */
async function mockCompilation(page: Page, workflowId: string) {
  const ctl = {
    polls: [] as { version: number; at: number }[],
    rebuilds: [] as number[],
    answer: (async (_version: number) => ({
      status: 200,
      body: { status: 'in_progress' } as unknown,
    })) as (version: number) => Promise<{ status: number; body: unknown }>,
    count: (version?: number) =>
      ctl.polls.filter((p) => version === undefined || p.version === version)
        .length,
  };
  await page.route(
    api(`workflows/${workflowId}/versions/\\d+/compilation-progress`),
    async (route) => {
      const version = Number(
        route
          .request()
          .url()
          .match(/versions\/(\d+)\/compilation/)![1]
      );
      ctl.polls.push({ version, at: Date.now() });
      const { status, body } = await ctl.answer(version);
      await json(route, body, status);
    }
  );
  await page.route(
    api(`workflows/${workflowId}/versions/\\d+/compile`),
    (route) => {
      ctl.rebuilds.push(
        Number(
          route
            .request()
            .url()
            .match(/versions\/(\d+)\/compile/)![1]
        )
      );
      return json(route, { success: true });
    }
  );
  return ctl;
}

const versionRow = (page: Page, version: number) =>
  page
    .locator('div.cursor-pointer')
    .filter({ has: page.getByText(`v${version}`, { exact: true }) });
const rebuildingButton = (page: Page, version: number) =>
  versionRow(page, version).getByRole('button', { name: 'Rebuilding' });
const rebuildButton = (page: Page, version: number) =>
  versionRow(page, version).getByRole('button', {
    name: 'Rebuild',
    exact: true,
  });
const openVersions = (page: Page) =>
  page.getByRole('button', { name: /^Versions/ }).click();
const failureToast = (page: Page) =>
  page.locator('[data-sonner-toast]').filter({ hasText: 'Compilation failed' });

test.describe('Workflow page audit: compilation watch', () => {
  test('WF-4 A compilation status of unknown does not poll indefinitely and Rebuilding clears', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf4');
    let c!: Awaited<ReturnType<typeof mockCompilation>>;
    await openWorkflow(
      page,
      mockApi,
      wf,
      async () => {
        c = await mockCompilation(page, wf.id!);
      },
      twoVersions
    );
    c.answer = async () => ({ status: 200, body: { status: 'unknown' } });

    await openVersions(page);
    await rebuildButton(page, 1).click();
    await expect(rebuildingButton(page, 1)).toBeVisible();
    await expect(rebuildingButton(page, 1)).toBeDisabled();
    await expect.poll(() => c.rebuilds).toEqual([1]);

    // 25 s is well past the 8 s failure clear and the 2.5 s success clear.
    await knownDefect('WF-4', async () => {
      await expect(rebuildingButton(page, 1)).toHaveCount(0, {
        timeout: 25_000,
      });
      expect(c.count(1)).toBeLessThan(18);
    });
    console.log('WF-4 polls in 25 s:', c.count(1));
    // Nothing in the toolbar says a build is going on.
    await expect(page.locator('header').getByText('Compiling')).toHaveCount(0);

    // Control: the same watch does end when a terminal status arrives.
    c.answer = async () => ({ status: 200, body: { status: 'success' } });
    await expect(rebuildButton(page, 1)).toBeVisible({ timeout: 8_000 });
    const atEnd = c.count(1);
    await page.waitForTimeout(3_000);
    expect(c.count(1)).toBe(atEnd);
  });

  test('WF-5 A failing compilation-progress endpoint does not poll indefinitely', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf5');
    let c!: Awaited<ReturnType<typeof mockCompilation>>;
    await openWorkflow(
      page,
      mockApi,
      wf,
      async () => {
        c = await mockCompilation(page, wf.id!);
      },
      twoVersions
    );
    c.answer = async () => ({ status: 500, body: { message: 'boom' } });

    await openVersions(page);
    await rebuildButton(page, 1).click();
    await expect.poll(() => c.count(1), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(rebuildingButton(page, 1)).toBeDisabled();

    await page.waitForTimeout(12_000);
    const mid = c.count(1);
    await page.waitForTimeout(13_000);
    const end = c.count(1);
    const toasts = await page.locator('[data-sonner-toast]').count();
    console.log(
      `WF-5 failed polls: ${mid} at 12 s, ${end} at 25 s; toasts visible: ${toasts}`
    );
    await knownDefect('WF-5', async () => {
      expect(end).toBeLessThanOrEqual(mid + 3);
      await expect(rebuildingButton(page, 1)).toHaveCount(0);
    });
  });

  test('WF-6 Rebuilding a version that recently failed does not show the cached failure', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf6');
    let c!: Awaited<ReturnType<typeof mockCompilation>>;
    await openWorkflow(
      page,
      mockApi,
      wf,
      async () => {
        c = await mockCompilation(page, wf.id!);
      },
      twoVersions
    );
    // Control: the first attempt, with nothing cached, shows no toast while its
    // answer is held.
    const firstHeld = gate();
    c.answer = async () => {
      await firstHeld.promise;
      return {
        status: 200,
        body: { status: 'failed', errorMessage: 'old failure' },
      };
    };

    await openVersions(page);
    await rebuildButton(page, 1).click();
    await expect.poll(() => c.count(1)).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await expect(failureToast(page)).toHaveCount(0);
    firstHeld.release();
    await expect(failureToast(page)).toBeVisible({ timeout: 8_000 });

    // The watch ends 8 s after failure; let the toast go as well.
    await expect(rebuildButton(page, 1)).toBeVisible({ timeout: 15_000 });
    await expect(failureToast(page)).toHaveCount(0, { timeout: 15_000 });

    // New rebuild. Its first progress answer is held: the client knows nothing
    // about this attempt yet.
    const held = gate();
    const before = c.count(1);
    let answered = false;
    c.answer = async () => {
      await held.promise;
      answered = true;
      return { status: 200, body: { status: 'in_progress' } };
    };
    await rebuildButton(page, 1).click();
    await expect.poll(() => c.rebuilds).toEqual([1, 1]);
    await expect.poll(() => c.count(1)).toBeGreaterThan(before);
    expect(answered).toBe(false);

    // Same wait as the control above. The counts do not retry: a retrying
    // "gone" check would pass once the toast timed out on its own.
    await page.waitForTimeout(1_000);
    expect(answered).toBe(false);
    await knownDefect('WF-6', async () => {
      expect(await failureToast(page).count()).toBe(0);
      expect(
        await page.locator('header').getByText('Compile failed').count()
      ).toBe(0);
    });

    held.release();
    await expect.poll(() => answered).toBe(true);
    await expect(page.locator('header').getByText('Compiling')).toBeVisible();
  });

  test('WF-7 Rebuilding version B while A is rebuilding keeps tracking A', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_wf7');
    let c!: Awaited<ReturnType<typeof mockCompilation>>;
    await openWorkflow(
      page,
      mockApi,
      wf,
      async () => {
        c = await mockCompilation(page, wf.id!);
      },
      twoVersions
    );

    await openVersions(page);
    await rebuildButton(page, 1).click();
    await expect(rebuildingButton(page, 1)).toBeVisible();
    await expect.poll(() => c.count(1), { timeout: 8_000 }).toBeGreaterThan(1);

    // B's button stays enabled while A builds.
    await expect(rebuildButton(page, 2)).toBeEnabled();
    await rebuildButton(page, 2).click();
    await expect(rebuildingButton(page, 2)).toBeVisible();
    await expect.poll(() => c.rebuilds).toEqual([1, 2]);

    // B's watch is established, so the switch has happened. A is still building
    // on the server.
    await expect.poll(() => c.count(2), { timeout: 8_000 }).toBeGreaterThan(1);
    const v1Polls = c.count(1);
    await page.waitForTimeout(5_000);
    expect(c.count(2)).toBeGreaterThan(3);

    // A now fails.
    c.answer = async (version) =>
      version === 1
        ? { status: 200, body: { status: 'failed', errorMessage: 'A failed' } }
        : { status: 200, body: { status: 'in_progress' } };
    await knownDefect('WF-7', async () => {
      await expect(rebuildButton(page, 1)).toHaveCount(0);
      await expect
        .poll(() => c.count(1), { timeout: 4_000 })
        .toBeGreaterThan(v1Polls);
      await expect(failureToast(page)).toBeVisible({ timeout: 4_000 });
    });
    console.log(
      `WF-7 v1 polls ${v1Polls} then ${c.count(1)}, v2 polls ${c.count(2)}, rebuilds ${c.rebuilds}`
    );
  });
});

test.describe('Execution audit: status and store', () => {
  test('EX-5 isDebugExecution has a reader, or is gone', async () => {
    const out = execSync(
      'grep -rn "isDebugExecution" src e2e/tests e2e/fixtures e2e/pages || true',
      { encoding: 'utf8' }
    );
    const lines = out.trim().split('\n').filter(Boolean);
    console.log(out);
    // Declaration, parameter, initial value, two writes: anything else reads it.
    const notReads = [
      'isDebugExecution: boolean;',
      'isDebugExecution?: boolean',
      'isDebugExecution: false,',
      'startExecution: (instanceId, workflowId, debugMode, isDebugExecution) => {',
      'state.isDebugExecution = isDebugExecution || false;',
      'state.isDebugExecution = false;',
    ];
    const reads = lines.filter(
      (l) =>
        !l.includes('stores/executionStore.ts') ||
        !notReads.includes(l.split(':').slice(2).join(':').trim())
    );
    await knownDefect('EX-5', async () => {
      // No occurrences at all also counts: the dead field is gone.
      expect(lines.length === 0 ? 1 : reads.length).toBeGreaterThan(0);
    });
  });

  test('EX-6 An unrecognized run status does not count as finished: Replay is not offered and polling continues', async ({
    page,
    mockApi,
  }) => {
    const wf = logWorkflow('wf_ex6');
    const entry = (id: string, runLabel: string, status: string) => ({
      id,
      instanceId: id,
      workflowId: wf.id,
      workflowName: wf.name,
      runLabel,
      status,
      created: '2026-01-01T12:00:00Z',
      createdAt: '2026-01-01T12:00:00Z',
    });
    const statuses: Record<string, string> = {
      inst_mystery: 'rehydrating',
      inst_running: 'running',
    };
    const polls: Record<string, number> = { inst_mystery: 0, inst_running: 0 };
    const inputPolls: Record<string, number> = {
      inst_mystery: 0,
      inst_running: 0,
    };

    await mockApi.bootstrap(page);
    await mockApi.workflows.list(page, [wf]);
    await mockApi.workflows.get(page, wf.id!, wf);
    await mockApi.invocationHistory.list(page, [
      entry('inst_mystery', 'MYSTERY', statuses.inst_mystery),
      entry('inst_running', 'RUNNING', statuses.inst_running),
    ]);
    await mockApi.raw(
      page,
      /\/api\/runtime(?:\/[^/]+)?\/executions\/summary$/,
      { data: { total: 2, counts: {} }, success: true }
    );
    await page.route(
      api(`workflows/${wf.id}/instances/(inst_mystery|inst_running)`),
      (route) => {
        const id = route
          .request()
          .url()
          .match(/instances\/(\w+)/)![1];
        polls[id] += 1;
        return json(route, {
          data: {
            instance: {
              id,
              workflowId: wf.id,
              status: statuses[id],
              created: '2026-01-01T12:00:00Z',
              inputs: { data: {} },
              steps: [],
            },
          },
          message: 'ok',
          success: true,
        });
      }
    );
    await page.route(
      /\/instances\/(inst_mystery|inst_running)\/pending-input/,
      (route) => {
        const id = route
          .request()
          .url()
          .match(/instances\/(\w+)/)![1];
        inputPolls[id] += 1;
        return json(route, { data: [], success: true });
      }
    );

    await page.goto('/operations/runs');
    const row = (label: string) =>
      page.getByRole('row').filter({
        has: page.getByRole('link', { name: label, exact: true }),
      });
    await expect(row('MYSTERY')).toBeVisible({ timeout: 15_000 });
    // Control: a known active run offers no Replay.
    await expect(row('RUNNING').getByLabel('Replay')).toHaveCount(0);
    await expect(
      row('RUNNING').getByLabel('Stop', { exact: false })
    ).toBeVisible();
    // Read once the row's actions have rendered, as the control above shows.
    const mysteryReplay = await row('MYSTERY').getByLabel('Replay').count();
    console.log(
      'EX-6 mystery row:',
      (await row('MYSTERY').innerText()).replace(/\s+/g, ' ')
    );

    // Run history page. Control first: a known active run keeps polling.
    await page.goto(`/workflows/${wf.id}/history/inst_running`);
    await expect
      .poll(() => polls.inst_running, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(12_000);
    const running = { ...polls, input: inputPolls.inst_running };

    await page.goto(`/workflows/${wf.id}/history/inst_mystery`);
    await expect
      .poll(() => polls.inst_mystery, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    const first = polls.inst_mystery;
    const firstInput = inputPolls.inst_mystery;
    expect(running.inst_running).toBeGreaterThanOrEqual(2);
    expect(running.input).toBeGreaterThanOrEqual(3);
    await knownDefect('EX-6', async () => {
      expect(mysteryReplay).toBe(0);
      await expect
        .poll(() => polls.inst_mystery, { timeout: 12_000 })
        .toBeGreaterThan(first);
      await expect
        .poll(() => inputPolls.inst_mystery, { timeout: 12_000 })
        .toBeGreaterThan(firstInput);
    });
    console.log(
      `EX-6 12 s window: running instance GETs ${running.inst_running}, pending-input ${running.input}; ` +
        `mystery instance GETs ${polls.inst_mystery} (${first} after load), pending-input ${inputPolls.inst_mystery} (${firstInput} after load)`
    );
  });
});

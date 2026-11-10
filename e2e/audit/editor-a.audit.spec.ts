import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  buildAgentInfo,
  buildCapabilityInfo,
  buildConnection,
  buildWorkflow,
  test,
} from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json, knownDefect, openWorkflow } from './helpers';

// Wide enough that the docked panel leaves the canvas clickable.
test.use({ viewport: { width: 1700, height: 1000 } });

type Saved = { executionGraph: { steps: Record<string, any> } };

const srcDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/features/workflows/components/WorkflowEditor'
);
const source = (file: string) => readFileSync(path.join(srcDir, file), 'utf8');
const mentions = (file: string, name: string) =>
  file.split('\n').filter((l) => new RegExp(`\\b${name}\\b`).test(l));
/** A ref is dead when it is still there but only declared and assigned. */
const isDeadRef = (file: string, name: string) => {
  const written = new RegExp(
    `const ${name} = useRef|^\\s*${name}\\.current = `
  );
  const uses = mentions(file, name);
  return uses.length > 0 && uses.every((l) => written.test(l));
};

const panel = (page: Page) => page.getByTestId('node-config-dialog');
const step = (page: Page, name: string) =>
  page.locator(
    `[data-testid="workflow-canvas-node"][data-step-name="${name}"]`
  );
const discardPrompt = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Discard changes to this step?' });
const messageBox = (page: Page) =>
  panel(page).getByPlaceholder('Enter log message...');

async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
}

async function openStep(page: Page, name: string) {
  await fitView(page);
  await step(page, name).first().dblclick();
  await expect(panel(page)).toBeVisible();
}

async function pickNewStep(page: Page, after: string, stepType: string) {
  await fitView(page);
  await page.getByRole('button', { name: `Add step after ${after}` }).click();
  await page.getByTestId(`step-picker-step-type-${stepType}`).click();
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * Clicks Cancel, confirms the discard prompt if one comes up, and returns
 * whether it did. Waits until one or the other has happened.
 */
async function closePanel(page: Page) {
  await panel(page).getByTestId('node-config-cancel').click();
  await expect
    .poll(
      async () =>
        (await discardPrompt(page).count()) > 0 ||
        (await panel(page).count()) === 0
    )
    .toBe(true);
  const prompted = await discardPrompt(page).isVisible();
  if (prompted) await page.getByRole('button', { name: 'Discard' }).click();
  await expect(panel(page)).toHaveCount(0);
  return prompted;
}

/** Waits until the panel has either re-anchored to `nodeId` or prompted. */
async function panelMovedOrPrompted(page: Page, nodeId: string) {
  await expect(
    page
      .locator(`[data-testid="node-config-dialog"][data-node-id="${nodeId}"]`)
      .or(discardPrompt(page))
      .first()
  ).toBeVisible();
  // The form resets just after the panel re-anchors.
  await page.waitForTimeout(500);
  return discardPrompt(page).isVisible();
}

/** Clicks Add step or Apply; waits until it is accepted or `refusal` shows. */
async function submitPanel(page: Page, refusal: () => Locator) {
  await panel(page).getByTestId('node-config-save').click();
  await expect
    .poll(
      async () =>
        (await panel(page).count()) === 0 || (await refusal().count()) > 0,
      { timeout: 10_000 }
    )
    .toBe(true);
}

async function applyPanel(page: Page) {
  await panel(page).getByTestId('node-config-save').click();
  await expect(panel(page)).toHaveCount(0, { timeout: 10_000 });
}

function captureSaves(page: Page, workflow: ReturnType<typeof buildWorkflow>) {
  const saves: Saved[] = [];
  return {
    saves,
    install: () =>
      page.route(api(`workflows/${workflow.id}/update`), (route) => {
        saves.push(route.request().postDataJSON());
        return json(route, {
          data: { ...workflow, currentVersionNumber: 2, lastVersionNumber: 2 },
          message: 'ok',
          success: true,
          version: '2',
        });
      }),
    save: async () => {
      const before = saves.length;
      const button = page.getByTitle('Save changes');
      await expect(button).toBeEnabled({ timeout: 10_000 });
      await button.click();
      await expect
        .poll(() => saves.length, { timeout: 15_000 })
        .toBe(before + 1);
      return saves[saves.length - 1].executionGraph;
    },
  };
}

const log = (id: string, name: string, x: number, message = `${id} msg`) => ({
  id,
  stepType: 'Log',
  name,
  message,
  level: 'info',
  renderingParameters: { x, y: 100 },
});

function graphWorkflow(
  id: string,
  steps: Record<string, unknown>,
  entryPoint: string,
  executionPlan: unknown[] = []
) {
  return buildWorkflow({
    id,
    name: 'Audit workflow',
    currentVersionNumber: 1,
    lastVersionNumber: 1,
    executionGraph: {
      name: 'Audit workflow',
      entryPoint,
      steps,
      executionPlan,
    } as never,
  });
}

const twoLogs = (id: string) =>
  graphWorkflow(
    id,
    { first: log('first', 'First', 100), second: log('second', 'Second', 500) },
    'first',
    [{ fromStep: 'first', toStep: 'second', label: 'next' }]
  );

const capability = (id: string, inputs: unknown[]) =>
  buildCapabilityInfo({
    id,
    name: id,
    displayName: id,
    inputType: 'AuditInput',
    inputs: inputs as never,
  });

const AUDIT_INPUTS = [
  { name: 'alpha_text', type: 'string', required: false },
  { name: 'blob', type: 'any', required: false },
  { name: 'nullable_one', type: 'string', required: false, nullable: true },
  { name: 'nullable_two', type: 'string', required: false, nullable: true },
];

function catalog(supportsConnections = false) {
  return [
    buildAgentInfo({
      id: 'audit-agent',
      name: 'Audit Agent',
      supportsConnections,
      integrationIds: supportsConnections ? ['audit_integration'] : [],
      capabilities: [
        capability('cap-a', AUDIT_INPUTS),
        capability('cap-b', AUDIT_INPUTS),
      ],
    }),
    buildAgentInfo({
      id: 'other-agent',
      name: 'Other Agent',
      capabilities: [capability('cap-other', [])],
    }),
  ];
}

function agentWorkflow(id: string, inputMapping: Record<string, unknown>) {
  return graphWorkflow(
    id,
    {
      agent: {
        id: 'agent',
        stepType: 'Agent',
        name: 'Agent Step',
        agentId: 'audit-agent',
        capabilityId: 'cap-a',
        inputMapping,
        renderingParameters: { x: 100, y: 100 },
      },
    },
    'agent'
  );
}

/** Opens `workflow` with the audit catalog and returns the save capture. */
async function open(
  page: Page,
  mockApi: MockApi,
  workflow: ReturnType<typeof buildWorkflow>,
  extraRoutes: () => Promise<unknown> = async () => {},
  supportsConnections = false
) {
  const capture = captureSaves(page, workflow);
  await openWorkflow(page, mockApi, workflow, async () => {
    await mockApi.agents.catalog(page, catalog(supportsConnections));
    await capture.install();
    await extraRoutes();
  });
  return capture;
}

const row = (page: Page, label: RegExp) =>
  panel(page).locator('tr').filter({ hasText: label });

test.describe('Editor audit A', () => {
  test('ED-1 Double-clicking a node while configuring a new step leaves one config panel', async ({
    page,
    mockApi,
  }) => {
    const wf = twoLogs('wf_ed1');
    await open(page, mockApi, wf);

    await pickNewStep(page, 'Second', 'log');
    await expect(panel(page)).toHaveCount(1);
    await expect(panel(page)).toContainText('New ');

    await step(page, 'First').first().dblclick();

    // One panel is already showing, so give the double-click time to land.
    await page.waitForTimeout(1_000);
    await knownDefect('ED-1', async () => {
      await expect(panel(page)).toHaveCount(1);
    });
  });

  test('ED-2 After deleting the edited node, a single click only selects', async ({
    page,
    mockApi,
  }) => {
    const wf = twoLogs('wf_ed2');
    await open(page, mockApi, wf);
    await fitView(page);

    // Control: with no editor open, a single click only selects.
    await step(page, 'Second').first().click();
    await page.waitForTimeout(300);
    await expect(panel(page)).toHaveCount(0);

    await openStep(page, 'First');
    await expect(panel(page)).toHaveAttribute('data-node-id', 'first');

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Delete');
    await expect(step(page, 'First')).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);

    // The same single click as the control must still open nothing.
    await step(page, 'Second').first().click();
    await page.waitForTimeout(1_000);
    // Fixed: deleting the edited step closed its editor.
    await expect(panel(page)).toHaveCount(0);
  });

  test('ED-3 Clicking another node does not silently discard unsaved panel edits', async ({
    page,
    mockApi,
  }) => {
    const wf = twoLogs('wf_ed3');
    const capture = await open(page, mockApi, wf);

    await openStep(page, 'First');
    await messageBox(page).fill('EDITED');
    await expect(messageBox(page)).toHaveValue('EDITED');

    // Fixed: a dirty panel asks before moving to another step.
    await step(page, 'Second').first().click();
    expect(await panelMovedOrPrompted(page, 'second')).toBe(true);

    // Keep editing: the panel stays on First with the edit.
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(discardPrompt(page)).toHaveCount(0);
    await expect(panel(page)).toHaveAttribute('data-node-id', 'first');
    await expect(messageBox(page)).toHaveValue('EDITED');

    // Discard: the panel moves on, and nothing of the edit is saved.
    await step(page, 'Second').first().click();
    await expect(discardPrompt(page)).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(panel(page)).toHaveAttribute('data-node-id', 'second');
    await closePanel(page);
    await page.getByTitle('Add note').click();
    expect((await capture.save()).steps.first.message).not.toBe('EDITED');

    // Control: a clean panel still moves with no prompt.
    await openStep(page, 'First');
    await step(page, 'Second').first().click();
    expect(await panelMovedOrPrompted(page, 'second')).toBe(false);
  });

  test('ED-4 Renaming a step id does not discard other unsaved panel edits', async ({
    page,
    mockApi,
  }) => {
    const wf = twoLogs('wf_ed4');
    const capture = await open(page, mockApi, wf);

    await openStep(page, 'First');
    await messageBox(page).fill('EDITED');

    await panel(page).getByRole('button', { name: 'Edit step id' }).click();
    await panel(page).getByLabel('Step id', { exact: true }).fill('renamed');
    await panel(page).getByRole('button', { name: 'Confirm step id' }).click();

    // Fixed: the rename is staged with the other edit, which stays put.
    await expect(panel(page).getByText('Renamed from first')).toBeVisible();
    await expect(messageBox(page)).toHaveValue('EDITED');
    await applyPanel(page);
    const graph = await capture.save();
    expect(Object.keys(graph.steps).sort()).toEqual(['renamed', 'second']);
    expect(graph.steps.renamed.message).toBe('EDITED');
  });

  test('ED-5 Panel Cancel reverts a step id rename', async ({
    page,
    mockApi,
  }) => {
    const wf = twoLogs('wf_ed5');
    const capture = await open(page, mockApi, wf);

    await openStep(page, 'First');
    await panel(page).getByRole('button', { name: 'Edit step id' }).click();
    await panel(page).getByLabel('Step id', { exact: true }).fill('renamed');
    await panel(page).getByRole('button', { name: 'Confirm step id' }).click();
    await expect(panel(page).getByText('Renamed from first')).toBeVisible();

    // Fixed: the staged rename makes Cancel ask, and Discard drops it.
    expect(await closePanel(page)).toBe(true);

    // A reverted rename leaves nothing to save, so make a change of our own.
    await page.getByTitle('Add note').click();
    const graph = await capture.save();
    expect(Object.keys(graph.steps).sort()).toEqual(['first', 'second']);
  });

  test('ED-6 onStagedChange can be invoked through the config panel, or is gone', async ({
    page,
    mockApi,
  }) => {
    const editor = source('index.tsx');
    const panels = editor.split('<NodeConfigPanel').slice(1);
    expect(panels).toHaveLength(2);
    const [editPanel, createPanel] = panels;
    // The panel only calls it for isCreate, and only the edit panel (which
    // never sets isCreate) receives the prop.
    const neverInvoked =
      editPanel.includes('onStagedChange={onStagedNodeChange}') &&
      !/\bisCreate\b/.test(editPanel) &&
      !createPanel.includes('onStagedChange') &&
      /if \(isCreate\) \{\s*onStagedChange\?\.\(nodeId, data\);/.test(
        source('NodeConfigPanel/index.tsx')
      );
    // Fixed: the never-called prop is gone.
    expect(neverInvoked).toBe(false);

    const wf = twoLogs('wf_ed6');
    await open(page, mockApi, wf);
    await openStep(page, 'First');
    await messageBox(page).fill('EDITED');
    await expect(messageBox(page)).toHaveValue('EDITED');

    // Control: applying the panel does mark the page unsaved.
    await applyPanel(page);
    await expect(page.getByTitle('Save changes')).toBeEnabled();
  });

  test('ED-7 stagedDataRef and prevOpenRef have a reader or are gone', async () => {
    const file = source('NodeConfigPanel/index.tsx');
    const stagedDead = isDeadRef(file, 'stagedDataRef');
    // prevOpenRef's one read guards this block, so it is only as alive as what
    // the block does.
    const guarded =
      /if \(open && !prevOpenRef\.current\) \{([\s\S]*?)\n\s*\}/.exec(
        file
      )?.[1] ?? '';
    const onlyWritesStaged = guarded
      .split('\n')
      .every((l) => !l.trim() || /^\s*stagedDataRef\.current = /.test(l));
    const dead = [
      ...(stagedDead ? ['stagedDataRef'] : []),
      ...(isDeadRef(file, 'prevOpenRef') ||
      (mentions(file, 'prevOpenRef').length > 0 &&
        onlyWritesStaged &&
        (stagedDead || !mentions(file, 'stagedDataRef').length))
        ? ['prevOpenRef']
        : []),
    ];
    // Fixed: the dead refs are gone.
    expect(dead).toEqual([]);
  });

  test('ED-8 isInitializedRef and previousNodeDataRef have a reader or are gone', async () => {
    const file = source(
      'NodeForm/InputMappingField/SimpleInputMappingEditor.tsx'
    );
    const dead = ['isInitializedRef', 'previousNodeDataRef'].filter((name) =>
      isDeadRef(file, name)
    );
    // Fixed: the dead refs are gone.
    expect(dead).toEqual([]);
  });

  test('ED-9 A new Filter step can be added with the default condition it displays', async ({
    page,
    mockApi,
  }) => {
    const wf = buildWorkflow({
      id: 'wf_ed9',
      name: 'Audit workflow',
      currentVersionNumber: 1,
      lastVersionNumber: 1,
      executionGraph: {
        name: 'Audit workflow',
        entryPoint: 'second',
        inputSchema: { items: { type: 'array', required: false } },
        steps: { second: log('second', 'Second', 100) },
        executionPlan: [],
      } as never,
    });
    const capture = await open(page, mockApi, wf);

    await pickNewStep(page, 'Second', 'filter');
    // The condition editor shows two operand boxes from the default.
    await expect(panel(page).getByPlaceholder('Arg 1')).toBeVisible();
    await expect(panel(page).getByPlaceholder('Arg 2')).toBeVisible();

    await panel(page).getByRole('combobox').first().click();
    await page
      .getByRole('option', { name: 'data.items (workflow input)' })
      .click();
    await expect(
      panel(page).getByText('data.items', { exact: false })
    ).not.toHaveCount(0);

    // The displayed condition must be in the form, so the step has a config.
    const missingConfig = () =>
      page
        .getByTestId('validation-message')
        .getByText('Failed to parse graph: missing field `config`');
    await submitPanel(page, missingConfig);
    await knownDefect('ED-9', async () => {
      await expect(missingConfig()).toHaveCount(0);
    });
    await expect(panel(page)).toHaveCount(1);
    await expect(step(page, 'Filter')).toHaveCount(0);

    // Control: typing and clearing an operand leaves the same blank condition
    // on screen, but now it is in the form, and the identical step is accepted.
    const arg1 = panel(page).getByPlaceholder('Arg 1');
    await arg1.fill('x');
    await arg1.fill('');
    await applyPanel(page);
    const graph = await capture.save();
    expect(graph.steps.filter.config.condition).toMatchObject({
      type: 'operation',
      op: 'EQ',
    });
  });

  test('ED-10 Add on-wait flow on an unsaved step adds the flow', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed10',
      {
        first: log('first', 'First', 100),
        wait: {
          id: 'wait',
          stepType: 'WaitForSignal',
          name: 'Existing Wait',
          renderingParameters: { x: 500, y: 100 },
        },
      },
      'first',
      [{ fromStep: 'first', toStep: 'wait', label: 'next' }]
    );
    await open(page, mockApi, wf);

    const flowHelp = /Runs before the workflow suspends/;
    const addFlow = () =>
      panel(page).getByRole('button', { name: 'Add on-wait flow' });

    // Control: on a step already on the canvas the button converts it.
    await openStep(page, 'Existing Wait');
    await panel(page)
      .getByRole('button', { name: 'Advanced Settings' })
      .click();
    await addFlow().click();
    await expect(panel(page).getByText(flowHelp)).toBeVisible();
    await panel(page).getByTestId('node-config-cancel').click();

    await pickNewStep(page, 'Existing Wait', 'waitforsignal');
    await panel(page)
      .getByRole('button', { name: 'Advanced Settings' })
      .click();
    await expect(addFlow()).toBeVisible();
    await addFlow().click();
    await knownDefect('ED-10', async () => {
      await expect(panel(page).getByText(flowHelp)).toBeVisible({
        timeout: 500,
      });
    });
  });

  test('ED-11 Closing the panel does not silently discard Switch case edits', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed11',
      {
        sw: {
          id: 'sw',
          stepType: 'Switch',
          name: 'Switch Step',
          config: {
            value: { valueType: 'immediate', value: 'x' },
            cases: [{ matchType: 'exact', match: 'orig', output: 'o' }],
          },
          renderingParameters: { x: 100, y: 100 },
        },
      },
      'sw'
    );
    await open(page, mockApi, wf);

    await openStep(page, 'Switch Step');
    await expect(panel(page).getByTestId('switch-case-match-0')).toHaveValue(
      'orig'
    );
    await panel(page).getByTestId('switch-add-case').click();
    await expect(panel(page).getByTestId('switch-case-match-1')).toBeVisible();
    await panel(page).getByTestId('switch-case-match-0').fill('CHANGED');
    await panel(page).getByTestId('switch-case-match-0').blur();
    await expect(panel(page).getByTestId('switch-case-match-0')).toHaveValue(
      'CHANGED'
    );

    // Fixed: case edits mark the panel dirty, so closing asks first.
    expect(await closePanel(page)).toBe(true);

    await openStep(page, 'Switch Step');
    await expect(panel(page).getByTestId('switch-case-match-0')).toHaveValue(
      'orig'
    );

    // Control: a name edit on the same panel does raise the prompt.
    await panel(page).getByPlaceholder('Step name').fill('Renamed Switch');
    await panel(page).getByTestId('node-config-cancel').click();
    await expect(discardPrompt(page)).toBeVisible();
  });

  test('ED-12 Closing the panel does not silently discard a connection, agent or capability change', async ({
    page,
    mockApi,
  }) => {
    const wf = agentWorkflow('wf_ed12', {});
    const connection = buildConnection({
      id: 'conn_audit',
      title: 'Audit Connection',
      integrationId: 'audit_integration',
    });
    await open(
      page,
      mockApi,
      wf,
      () =>
        page.route(api('connections/operator/[^/]+'), (route) =>
          json(route, { connections: [connection], count: 1, success: true })
        ),
      true
    );
    const subtitle = () =>
      panel(page).getByRole('button', {
        name: /Audit Agent → |Other Agent → /,
      });

    const selectConnection = () =>
      panel(page).getByRole('button', { name: 'Select connection' });
    const auditConnection = () =>
      panel(page).getByRole('button', { name: 'Audit Connection' });

    // Fixed: each change marks the panel dirty, so closing asks first, and
    // discarding brings back what was there.

    // Connection.
    await openStep(page, 'Agent Step');
    await selectConnection().click();
    await page.getByRole('button', { name: /Audit Connection/ }).click();
    await expect(auditConnection()).toBeVisible();
    expect(await closePanel(page)).toBe(true);

    // Capability.
    await openStep(page, 'Agent Step');
    await expect(selectConnection()).toBeVisible();
    await subtitle().click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Audit Agent/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cap-b/ })
      .click();
    await expect(subtitle()).toContainText('cap-b');
    expect(await closePanel(page)).toBe(true);

    // Agent.
    await openStep(page, 'Agent Step');
    await expect(subtitle()).not.toContainText('cap-b');
    await subtitle().click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Other Agent/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cap-other/ })
      .click();
    await expect(subtitle()).toContainText('Other Agent → cap-other');
    expect(await closePanel(page)).toBe(true);

    await openStep(page, 'Agent Step');
    await expect(subtitle()).toContainText('Audit Agent');
  });

  test('ED-13 A non-empty scalar survives entering composite mode', async ({
    page,
    mockApi,
  }) => {
    const wf = agentWorkflow('wf_ed13', {
      alpha_text: { valueType: 'immediate', value: 'keep me' },
    });
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'Agent Step');

    const r = row(page, /alpha/i);
    await expect(r.locator('textarea, input').first()).toHaveValue('keep me');
    await r.getByRole('button', { name: 'Switch to template mode' }).click();
    await r.getByRole('button', { name: 'Switch to reference mode' }).click();
    await expect(r.getByText('keep me', { exact: true })).toBeVisible();
    await r.getByRole('button', { name: 'Switch to composite mode' }).click();

    await applyPanel(page);
    const graph = await capture.save();
    const saved = graph.steps.agent.inputMapping.alpha_text;
    expect(saved.valueType).toBe('composite');
    await knownDefect('ED-13', async () => {
      expect(JSON.stringify(saved)).toContain('keep me');
    });
  });

  test('ED-14 Composite to string to composite keeps the structure', async ({
    page,
    mockApi,
  }) => {
    const wf = agentWorkflow('wf_ed14', {
      blob: {
        valueType: 'composite',
        value: { keep: { valueType: 'immediate', value: 'kept' } },
      },
    });
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'Agent Step');
    await expect(panel(page).getByText('keep', { exact: true })).toBeVisible();

    await panel(page)
      .getByRole('button', { name: 'Value', exact: true })
      .click();
    // Leaving Build collapses the editor; open it again to come back.
    await panel(page)
      .getByRole('button', { name: /Click to configure/ })
      .click();
    await panel(page)
      .getByRole('button', { name: 'Build', exact: true })
      .click();

    await applyPanel(page);
    const graph = await capture.save();
    const saved = graph.steps.agent.inputMapping.blob;
    expect(saved.valueType).toBe('composite');
    await knownDefect('ED-14', async () => {
      expect(JSON.stringify(saved)).toContain('kept');
    });
  });

  test('ED-15 A literal null does not reach the form under template or reference, and is never saved as null', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed15',
      {
        agent: {
          id: 'agent',
          stepType: 'Agent',
          name: 'Agent Step',
          agentId: 'audit-agent',
          capabilityId: 'cap-a',
          inputMapping: {
            custom_one: { valueType: 'immediate', value: 'x' },
            custom_two: { valueType: 'immediate', value: 'y' },
          },
          renderingParameters: { x: 100, y: 100 },
        },
        finish: {
          id: 'finish',
          stepType: 'Finish',
          name: 'Finish Step',
          inputMapping: {
            out_tpl: { valueType: 'immediate', value: 'p' },
            out_ref: { valueType: 'immediate', value: 'q' },
          },
          renderingParameters: { x: 500, y: 100 },
        },
      },
      'agent',
      [{ fromStep: 'agent', toStep: 'finish', label: 'next' }]
    );
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'Agent Step');

    const nullError = () =>
      page
        .getByTestId('validation-message')
        .filter({ hasText: 'Step: Finish Step' })
        .getByText('invalid type: null, expected a string');
    const discardFinish = async () => {
      await panel(page).getByTestId('node-config-cancel').click();
      await page.getByRole('button', { name: 'Discard' }).click();
      await expect(panel(page)).toHaveCount(0);
    };
    const finishRow = (name: RegExp) => panel(page).getByRole('row', { name });

    // Finish, template: accepted, and not saved as null.
    await openStep(page, 'Finish Step');
    const tpl = finishRow(/out_tpl/);
    await tpl.getByTitle('Set literal null').click();
    await tpl.getByRole('button', { name: 'Switch to template mode' }).click();
    await applyPanel(page);
    const finishGraph = await capture.save();
    const savedTpl = finishGraph.steps.finish.inputMapping.out_tpl;
    expect(savedTpl.valueType).toBe('template');
    expect(savedTpl.value).not.toBeNull();

    // Finish, reference: the form must not hold null for the validator to refuse.
    await openStep(page, 'Finish Step');
    const ref = finishRow(/out_ref/);
    await ref.getByTitle('Set literal null').click();
    await ref.getByRole('button', { name: 'Switch to template mode' }).click();
    await ref.getByRole('button', { name: 'Switch to reference mode' }).click();
    await submitPanel(page, () =>
      page
        .getByTestId('validation-message')
        .filter({ hasText: /Step: Finish Step|Step 'finish'/ })
    );
    // Fixed: entering reference mode turns the null into an empty path, which
    // is refused as one rather than as the wrong type.
    await expect(nullError()).toHaveCount(0);
    await expect(
      page
        .getByTestId('validation-message')
        .getByText(
          "Step 'finish' has invalid reference path '': empty reference path"
        )
    ).toBeVisible();
    await expect(panel(page)).toHaveCount(1);
    await discardFinish();

    // Agent custom field, template: saved, and not as null.
    await openStep(page, 'Agent Step');
    const one = row(page, /custom_one/);
    await one.getByRole('button', { name: 'auto' }).click();
    await page.getByRole('menuitem', { name: 'String' }).click();
    await one.getByTitle('Set literal null').click();
    await expect(one.getByText('null', { exact: true })).toBeVisible();
    await one.getByRole('button', { name: 'Switch to template mode' }).click();
    await applyPanel(page);
    const graph = await capture.save();
    const savedOne = graph.steps.agent.inputMapping.custom_one;
    expect(savedOne.valueType).toBe('template');
    expect(savedOne.value).not.toBeNull();

    // Agent custom field, reference: refused as an empty path.
    await openStep(page, 'Agent Step');
    const two = row(page, /custom_two/);
    await two.getByRole('button', { name: 'auto' }).click();
    await page.getByRole('menuitem', { name: 'String' }).click();
    await two.getByTitle('Set literal null').click();
    await two.getByRole('button', { name: 'Switch to template mode' }).click();
    await two.getByRole('button', { name: 'Switch to reference mode' }).click();
    await panel(page).getByTestId('node-config-save').click();
    await expect(
      page
        .getByTestId('validation-message')
        .getByText("invalid reference path '': empty reference path")
    ).toBeVisible({ timeout: 10_000 });
    await expect(panel(page)).toHaveCount(1);
  });

  test('ED-16 Mapping-object rows keep the value across a mode switch', async ({
    page,
    mockApi,
  }) => {
    const wf = buildWorkflow({
      id: 'wf_ed16',
      name: 'Audit workflow',
      currentVersionNumber: 1,
      lastVersionNumber: 1,
      executionGraph: {
        name: 'Audit workflow',
        entryPoint: 'first',
        inputSchema: { foo: { type: 'string', required: false } },
        steps: {
          first: {
            ...log('first', 'First', 100),
            context: {
              a_imm: { valueType: 'immediate', value: 'keep me' },
              b_ref: { valueType: 'reference', value: 'data.foo' },
              c_tpl: { valueType: 'template', value: 'keep {{ data.foo }}' },
              d_cmp: {
                valueType: 'composite',
                value: { inner: { valueType: 'immediate', value: 'kept' } },
              },
            },
          },
        },
        executionPlan: [],
      } as never,
    });
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'First');

    const keys = panel(page).getByPlaceholder('Key');
    await expect(keys).toHaveCount(4);
    await expect(keys.nth(0)).toHaveValue('a_imm');
    await expect(
      panel(page).getByPlaceholder('Enter value...').first()
    ).toHaveValue('keep me');
    await expect(
      panel(page).getByText('data.foo', { exact: true })
    ).toBeVisible();
    await expect(panel(page).getByText('inner', { exact: true })).toBeVisible();

    const rowToggle = (key: string) =>
      panel(page)
        .locator('div.rounded-md.border.bg-background')
        .filter({ has: page.locator(`input[placeholder="Key"]`) })
        .filter({ has: page.locator(`input[value="${key}"]`) })
        .getByRole('button', {
          name: /^Switch to (immediate|template|reference|composite) mode$/,
        })
        .first();

    await rowToggle('a_imm').click(); // immediate -> template
    await rowToggle('b_ref').click(); // reference -> composite
    await rowToggle('c_tpl').click(); // template -> reference
    await rowToggle('c_tpl').click(); // an empty reference would not validate
    await rowToggle('d_cmp').click(); // composite -> immediate

    await applyPanel(page);
    const graph = await capture.save();
    const context: Record<string, { valueType: string }> =
      graph.steps.first.context;
    // Control: every toggle landed.
    expect(
      Object.fromEntries(
        Object.entries(context).map(([key, v]) => [key, v.valueType])
      )
    ).toEqual({
      a_imm: 'template',
      b_ref: 'composite',
      c_tpl: 'composite',
      d_cmp: 'immediate',
    });
    const originals = {
      a_imm: 'keep me',
      b_ref: 'data.foo',
      c_tpl: 'keep {{ data.foo }}',
      d_cmp: 'kept',
    };
    const wiped = Object.entries(originals)
      .filter(([key, value]) => !JSON.stringify(context[key]).includes(value))
      .map(([key]) => key);
    await knownDefect('ED-16', async () => {
      expect(wiped).toEqual([]);
    });
  });

  test('ED-17 Value to Build to Value keeps the JSON value', async ({
    page,
    mockApi,
  }) => {
    const wf = agentWorkflow('wf_ed17', {
      blob: { valueType: 'immediate', value: { a: 1 } },
    });
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'Agent Step');
    await row(page, /blob/i).getByRole('button', { expanded: false }).click();
    const box = panel(page).getByPlaceholder('Enter a JSON value...');
    await expect(box).toHaveValue(/"a": 1/);
    await panel(page)
      .getByRole('button', { name: 'Build', exact: true })
      .click();
    await expect(box).toHaveCount(0);
    await panel(page)
      .getByRole('button', { name: 'Value', exact: true })
      .click();
    await expect(box).toBeVisible();
    await applyPanel(page);
    const graph = await capture.save();
    await knownDefect('ED-17', async () => {
      expect(graph.steps.agent.inputMapping?.blob?.value).toEqual({ a: 1 });
    });
  });

  test('ED-18 Switch output: Reference and Value leave composite without wiping the data', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed18',
      {
        sw: {
          id: 'sw',
          stepType: 'Switch',
          name: 'Switch Step',
          config: {
            value: { valueType: 'immediate', value: 'x' },
            cases: [
              { matchType: 'exact', match: 'a', output: { one: 'first' } },
              { matchType: 'exact', match: 'b', output: { two: 'second' } },
            ],
          },
          renderingParameters: { x: 100, y: 100 },
        },
      },
      'sw'
    );
    const capture = await open(page, mockApi, wf);
    await openStep(page, 'Switch Step');
    const c0 = panel(page).getByTestId('switch-case-output-0');
    const c1 = panel(page).getByTestId('switch-case-output-1');
    await expect(c0.getByText('one', { exact: true })).toBeVisible();
    await expect(c1.getByText('two', { exact: true })).toBeVisible();

    await c0.getByRole('button', { name: 'Reference', exact: true }).click();
    await c1.getByRole('button', { name: 'Value', exact: true }).click();
    // Both clicks had a re-render to do before the Build editors are read.
    await page.waitForTimeout(500);
    const stuckInBuild = [
      await c0.getByText('(0 fields)').count(),
      await c1.getByText('(0 fields)').count(),
    ];

    // An empty reference may fairly be refused, which leaves no payload to read.
    await submitPanel(page, () => page.getByTestId('validation-message'));
    let valueOutputKept = true;
    if ((await panel(page).count()) === 0) {
      const graph = await capture.save();
      valueOutputKept = JSON.stringify(
        graph.steps.sw.config.cases[1].output
      ).includes('second');
    }
    await knownDefect('ED-18', async () => {
      expect({ stuckInBuild, valueOutputKept }).toEqual({
        stuckInBuild: [0, 0],
        valueOutputKept: true,
      });
    });
  });
});

import { expect, type Locator, type Page } from '@playwright/test';
import {
  test,
  buildAgentInfo,
  buildCapabilityInfo,
  buildWorkflow,
} from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json, knownDefect, logWorkflow, openWorkflow } from './helpers';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const CATALOG = [
  buildAgentInfo({
    id: 'toolkit',
    name: 'Toolkit',
    capabilities: [
      buildCapabilityInfo({
        id: 'cap-any',
        name: 'Any Cap',
        displayName: 'Any Cap',
        inputs: [{ name: 'payload', type: 'any', required: false }] as never,
      }),
      buildCapabilityInfo({
        id: 'cap-file',
        name: 'File Cap',
        displayName: 'File Cap',
        inputs: [{ name: 'attachment', type: 'file', required: true }] as never,
      }),
      buildCapabilityInfo({
        id: 'cap-a',
        name: 'Alpha Cap',
        displayName: 'Alpha Cap',
        inputs: [],
      }),
      buildCapabilityInfo({
        id: 'cap-b',
        name: 'Beta Cap',
        displayName: 'Beta Cap',
        inputs: [],
      }),
    ],
  }),
  buildAgentInfo({
    id: 'memstore',
    name: 'Memstore',
    capabilities: [
      buildCapabilityInfo({
        id: 'memory',
        name: 'Memory',
        displayName: 'Memory',
        tags: ['memory:read', 'memory:write'],
        inputs: [
          { name: 'conversation_id', type: 'string', required: false },
          { name: 'messages', type: 'json', required: false },
        ] as never,
      }),
    ],
  }),
];

type Steps = Record<string, Record<string, unknown>>;

function graphWorkflow(
  id: string,
  entryPoint: string,
  steps: Steps,
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

const agentStep = (
  capabilityId: string,
  inputMapping: Record<string, unknown> = {}
) => ({
  id: 'worker',
  stepType: 'Agent',
  name: 'Worker',
  agentId: 'toolkit',
  capabilityId,
  inputMapping,
  renderingParameters: { x: 100, y: 100 },
});

const anyComposite = (value: unknown) =>
  graphWorkflowSteps(
    agentStep('cap-any', { payload: { valueType: 'composite', value } })
  );

const graphWorkflowSteps = (step: Record<string, unknown>): Steps => ({
  [step.id as string]: step,
});

const LOG = (id: string, x: number) => ({
  id,
  stepType: 'Log',
  name: id,
  message: id,
  level: 'info',
  renderingParameters: { x, y: 100 },
});

const COND = {
  type: 'operation',
  op: 'EQ',
  arguments: [
    { valueType: 'immediate', value: 'left-marker' },
    { valueType: 'immediate', value: 'right-marker' },
  ],
};

const routeWorkflow = (id: string) =>
  graphWorkflow(id, 'a', { a: LOG('a', 100), b: LOG('b', 400) }, [
    { fromStep: 'a', toStep: 'b', priority: 3, condition: COND },
  ]);

const AI_AGENT = {
  id: 'brain',
  stepType: 'AiAgent',
  name: 'Brain',
  connectionId: 'conn_llm',
  config: {
    systemPrompt: { valueType: 'immediate', value: 'sys' },
    userPrompt: { valueType: 'immediate', value: 'hello' },
    model: { valueType: 'immediate', value: 'gpt-4o-mini' },
  },
  renderingParameters: { x: 100, y: 100 },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type Ctl = { payload: () => any; saves: () => number };

/** Opens the editor with the agent catalog and a capturing update mock. */
async function open(
  page: Page,
  mockApi: MockApi,
  wf: ReturnType<typeof buildWorkflow>,
  routes: () => Promise<unknown> = async () => {}
): Promise<Ctl> {
  let last: any = null;
  let saves = 0;
  await openWorkflow(page, mockApi, wf, async () => {
    await mockApi.agents.catalog(page, CATALOG);
    await page.route(api(`workflows/${wf.id}/update`), (route) => {
      saves += 1;
      last = route.request().postDataJSON();
      return json(route, {
        data: { ...wf, currentVersionNumber: 2, lastVersionNumber: 2 },
        message: 'ok',
        success: true,
        version: '2',
      });
    });
    await routes();
  });
  return { payload: () => last, saves: () => saves };
}

const canvasStep = (page: Page, name: string) =>
  page.locator(
    `[data-testid="workflow-canvas-node"][data-step-name="${name}"]`
  );

/** AI Agent cards carry no data-step-name, so they are addressed by node id. */
async function openAiPanel(page: Page): Promise<Locator> {
  await page.locator('.react-flow__controls-fitview').click();
  await page
    .locator('.react-flow__node[data-id="brain"]')
    .getByText('Brain', { exact: true })
    .dblclick();
  const panel = page.getByTestId('node-config-dialog');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

async function openPanel(page: Page, name: string): Promise<Locator> {
  await page.locator('.react-flow__controls-fitview').click();
  await canvasStep(page, name).first().dblclick();
  const panel = page.getByTestId('node-config-dialog');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

/** Applies the panel, saves the workflow, returns the POSTed graph. */
async function applyAndSave(page: Page, panel: Locator, ctl: Ctl) {
  await panel.getByTestId('node-config-save').click();
  await expect(panel).toHaveCount(0, { timeout: 10_000 });
  return save(page, ctl);
}

async function save(page: Page, ctl: Ctl) {
  const before = ctl.saves();
  const button = page.getByTitle('Save changes');
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  await expect
    .poll(() => ctl.saves(), { timeout: 15_000 })
    .toBeGreaterThan(before);
  return ctl.payload().executionGraph;
}

async function openRoutePopover(page: Page): Promise<Locator> {
  await page.locator('.react-flow__controls-fitview').click();
  await page
    .locator('.react-flow__edge[data-id^="a-b"]')
    .click({ force: true });
  await page.getByTestId('edge-route-settings').click();
  const pop = page.getByRole('dialog').filter({ hasText: 'Route settings' });
  await expect(pop).toBeVisible();
  return pop;
}

const ANY_FIRST = {
  first: { valueType: 'immediate', value: 'keep-me' },
  second: { valueType: 'immediate', value: 'keep-me-too' },
};

/** The node ids the store holds, read through the app's own module instance. */
async function storeNodes(page: Page) {
  return page.evaluate(async () => {
    const m = await import(
      '/src/features/workflows/stores/workflowStore.ts' as string
    );
    return m.useWorkflowStore.getState().nodes.map((n: any) => ({
      id: n.id,
      inputMapping: n.data?.inputMapping,
    }));
  });
}

async function history(page: Page) {
  return page.evaluate(async () => {
    const m = await import(
      '/src/features/workflows/stores/workflowStore.ts' as string
    );
    const s = m.useWorkflowStore.getState();
    // null once the history code is gone, which ED-36 accepts as correct.
    return { length: s.history?.length ?? null };
  });
}

/** selectedAgent state of the mounted CapabilityPickerModal, via its fiber. */
async function pickerSelectedAgent(page: Page) {
  return page
    .getByRole('dialog')
    .first()
    .evaluate((el) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
      let fiber = (el as any)[key];
      while (fiber && fiber.type?.name !== 'CapabilityPickerModal')
        fiber = fiber.return;
      if (!fiber) throw new Error('CapabilityPickerModal fiber not found');
      let hook = fiber.memoizedState;
      while (hook) {
        // viewMode's useState is immediately followed by selectedAgent's.
        if (
          hook.queue &&
          ['browse', 'search', 'capabilities'].includes(hook.memoizedState)
        ) {
          return { found: true, selectedAgent: hook.next.memoizedState };
        }
        hook = hook.next;
      }
      return { found: false, selectedAgent: null };
    });
}

const ENTITLEMENTS = (agents: string[]) => ({
  tenantId: 'org_mocked_e2e',
  pricingTier: 'default',
  features: { database: true, api: true, mcp: true },
  agents,
  limits: {},
});

const memoryWorkflow = (id: string) =>
  graphWorkflow(
    id,
    'brain',
    {
      brain: {
        ...AI_AGENT,
        config: {
          ...AI_AGENT.config,
          memory: {
            conversationId: { valueType: 'immediate', value: 'conv-saved' },
          },
        },
      },
      mem: {
        id: 'mem',
        stepType: 'Agent',
        name: 'Mem',
        agentId: 'memstore',
        capabilityId: 'memory',
        inputMapping: {
          conversation_id: { valueType: 'immediate', value: 'conv-saved' },
        },
        renderingParameters: { x: 400, y: 100 },
      },
    },
    [{ fromStep: 'brain', toStep: 'mem', label: 'memory' }]
  );

test.describe('Editor audit B', () => {
  test('ED-19 Switching composite between object and array keeps the data or prompts first', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow('wf_ed19', 'worker', anyComposite(ANY_FIRST));
    const ctl = await open(page, mockApi, wf);
    const panel = await openPanel(page, 'Worker');
    const inputs = panel.getByRole('textbox', { name: 'Enter value...' });
    await expect(inputs).toHaveCount(2);
    await expect(inputs.first()).toHaveValue('keep-me');
    let nativeDialog = false;
    page.on('dialog', (dialog) => {
      nativeDialog = true;
      void dialog.dismiss();
    });

    await panel.getByRole('button', { name: 'Composite Array' }).click();

    // A prompt would have to show by now; without one, what gets saved decides.
    await page.waitForTimeout(500);
    const prompted =
      nativeDialog || (await page.getByRole('alertdialog').count()) > 0;
    const graph = prompted ? null : await applyAndSave(page, panel, ctl);
    await knownDefect('ED-19', async () => {
      if (!graph) return;
      expect(graph.steps.worker.inputMapping.payload.valueType).toBe(
        'composite'
      );
      expect(
        JSON.stringify(graph.steps.worker.inputMapping.payload.value)
      ).toContain('keep-me');
    });
  });

  test('ED-20 Re-selecting the current type of a composite item keeps its value', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow('wf_ed20', 'worker', anyComposite(ANY_FIRST));
    const ctl = await open(page, mockApi, wf);
    const panel = await openPanel(page, 'Worker');
    const input = panel
      .getByRole('textbox', { name: 'Enter value...' })
      .first();
    await expect(input).toHaveValue('keep-me');

    await panel.getByRole('button', { name: 'immediate' }).first().click();
    await page.getByRole('menuitem', { name: 'Immediate' }).click();

    // The POST, not the input: the input showed keep-me before the click too.
    const graph = await applyAndSave(page, panel, ctl);
    const saved = graph.steps.worker.inputMapping.payload.value;
    expect(saved.second).toEqual({
      valueType: 'immediate',
      value: 'keep-me-too',
    });
    await knownDefect('ED-20', async () => {
      expect(saved.first).toEqual({ valueType: 'immediate', value: 'keep-me' });
    });
  });

  test('ED-21 Cancelling the reference picker restores the original value', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow('wf_ed21', 'worker', anyComposite(ANY_FIRST));
    await open(page, mockApi, wf);
    const panel = await openPanel(page, 'Worker');
    await expect(
      panel.getByRole('textbox', { name: 'Enter value...' }).first()
    ).toHaveValue('keep-me');

    await panel.getByRole('button', { name: 'immediate' }).first().click();
    await page.getByRole('menuitem', { name: 'Reference' }).click();
    const picker = page.getByRole('dialog', { name: 'Select Variable' });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);

    const left = panel.getByRole('textbox', { name: 'Enter value...' });
    await knownDefect('ED-21', async () => {
      await expect(left).toHaveCount(2);
      await expect(left.first()).toHaveValue('keep-me');
      await expect(panel.getByText('Click to select variable...')).toHaveCount(
        0
      );
      // With the value back there is no empty reference for E011 to refuse.
      await panel.getByTestId('node-config-save').click();
      await expect(panel).toHaveCount(0, { timeout: 10_000 });
    });
  });

  test('ED-22 Decimals can be typed into auto-typed composite items', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed22',
      'worker',
      anyComposite({ first: { valueType: 'immediate', value: '' } })
    );
    const ctl = await open(page, mockApi, wf);
    const panel = await openPanel(page, 'Worker');
    const input = panel
      .getByRole('textbox', { name: 'Enter value...' })
      .first();
    await input.click();

    await input.pressSequentially('1.5');

    // Both digits landed, whether or not the point did.
    await expect(input).toHaveValue(/^1\.?5$/);
    const typed = await input.inputValue();
    const graph = await applyAndSave(page, panel, ctl);
    expect(typed).toBe('1.5');
    expect(graph.steps.worker.inputMapping.payload.value.first.value).toBe(1.5);
  });

  test('ED-23 File input with a {{ value in upload mode: Upload is honoured and Reference keeps the value', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed23',
      'worker',
      graphWorkflowSteps(agentStep('cap-file'))
    );
    await open(page, mockApi, wf);

    const reachUploadModeWithBraces = async () => {
      const panel = await openPanel(page, 'Worker');
      await panel
        .getByRole('button', { name: /Add custom parameter/ })
        .waitFor();
      const fileRow = panel.getByRole('row', { name: /attachment/ });
      const box = panel.getByPlaceholder("{{steps['stepId'].outputs.file}}");
      await expect(
        fileRow.getByRole('button', { name: 'Upload', exact: true })
      ).toBeVisible();
      await expect(box).toHaveCount(0); // upload mode

      // The only way found into mode=upload + `{{`: the stored FileData JSON
      // carries the file name, and a name can contain `{{`.
      await fileRow.locator('input[type="file"]').setInputFiles({
        name: '{{report}}.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      });
      await expect(box).toBeVisible();
      await expect(box).toHaveValue(/\{\{report\}\}\.txt/);
      return { fileRow, box, uploaded: await box.inputValue() };
    };

    const first = await reachUploadModeWithBraces();
    await first.fileRow
      .getByRole('button', { name: 'Upload', exact: true })
      .click();
    await knownDefect('ED-23', async () => {
      await expect(first.box).toHaveCount(0, { timeout: 300 });
    });

    // A fresh start, so the Reference facet does not depend on what Upload did.
    await page.reload();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({
      timeout: 15_000,
    });
    const second = await reachUploadModeWithBraces();
    await second.fileRow
      .getByRole('button', { name: 'Reference', exact: true })
      .click();
    // The box held this value before the click, so give the click time to act.
    await page.waitForTimeout(300);
    await knownDefect('ED-23', async () => {
      await expect(second.box).toHaveValue(second.uploaded);
    });
  });

  test('ED-24 Clearing the condition prop clears the condition editor', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, routeWorkflow('wf_ed24'));

    // UI: the popover Clear remounts the editor, which hides the bug.
    const pop = await openRoutePopover(page);
    await expect(pop.getByPlaceholder('Arg 1')).toHaveValue('left-marker');
    await pop.getByRole('button', { name: 'Clear' }).click();
    await expect(pop.getByPlaceholder('Arg 1')).not.toHaveValue('left-marker');
    await page.keyboard.press('Escape');

    // The real component, same React, no remount: only the prop changes.
    const seen = await page.evaluate(async (cond) => {
      const url = '/src/shared/components/ui/condition-editor.tsx';
      const src = await (await fetch(url)).text();
      const react = src.match(
        /"(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/
      )![1];
      const client = react.replace('react.js', 'react-dom_client.js');
      const reactMod = (await import(react)) as any;
      const clientMod = (await import(client)) as any;
      const { createElement } = reactMod.default ?? reactMod;
      const { createRoot } = clientMod.default ?? clientMod;
      const { ConditionEditor } = (await import(url)) as any;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const arg1 = async (value: string | undefined) => {
        root.render(createElement(ConditionEditor, { value, onChange() {} }));
        await new Promise((r) => setTimeout(r, 200));
        return (
          host.querySelector(
            'input[placeholder="Arg 1"]'
          ) as HTMLInputElement | null
        )?.value;
      };
      const other = JSON.parse(JSON.stringify(cond));
      other.arguments[0].value = 'changed-marker';
      const result = {
        initial: await arg1(JSON.stringify(cond)),
        changed: await arg1(JSON.stringify(other)),
        cleared: await arg1(undefined),
      };
      root.unmount();
      host.remove();
      return result;
    }, COND);

    expect(seen.initial).toBe('left-marker');
    expect(seen.changed).toBe('changed-marker'); // the prop does sync normally
    await knownDefect('ED-24', async () => {
      expect(seen.cleared).not.toBe('changed-marker');
    });
  });

  test('ED-25 Closing route settings without Apply discards the draft on reopen', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, routeWorkflow('wf_ed25'));
    const pop = await openRoutePopover(page);
    await expect(pop.getByLabel('Priority')).toHaveValue('3');
    await pop.getByLabel('Priority').fill('99');

    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.getByTitle('No changes to save')).toBeVisible();

    await page.getByTestId('edge-route-settings').click();
    await expect(pop).toBeVisible();
    await knownDefect('ED-25', async () => {
      await expect(pop.getByLabel('Priority')).toHaveValue('3');
    });
  });

  test('ED-26 Route settings: a stale error clears after editing', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, routeWorkflow('wf_ed26'));
    const pop = await openRoutePopover(page);
    await pop.getByTestId('edge-route-condition-mode').click();
    const text = pop.locator('textarea');
    await text.fill('{bad');
    await pop.getByRole('button', { name: 'Apply' }).click();
    const error = pop.getByText(/Condition JSON:/);
    await expect(error).toBeVisible();

    await text.fill(JSON.stringify(COND));
    await pop.getByLabel('Priority').fill('5');
    await knownDefect('ED-26', async () => {
      await expect(error).toBeHidden({ timeout: 300 });
    });

    // The text really was valid: Apply accepts it and closes.
    await pop.getByRole('button', { name: 'Apply' }).click();
    await expect(pop).toHaveCount(0);
  });

  test('ED-27 Route settings: Clear commits nothing until Apply', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, routeWorkflow('wf_ed27'));
    const pop = await openRoutePopover(page);
    await expect(pop.getByLabel('Priority')).toHaveValue('3');
    await expect(page.getByTitle('No changes to save')).toBeVisible();

    await pop.getByRole('button', { name: 'Clear' }).click();

    await expect(pop).toBeVisible(); // still open, Apply never clicked
    // The draft has been cleared, so Clear has acted.
    await expect(pop.getByLabel('Priority')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await knownDefect('ED-27', async () => {
      await expect(page.getByTitle('No changes to save')).toBeVisible();
      await page.getByTestId('edge-route-settings').click();
      await expect(pop.getByLabel('Priority')).toHaveValue('3');
    });
  });

  test('ED-28 Step picker: capabilities, typing and clearing a query returns to capabilities', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, logWorkflow('wf_ed28'));
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByRole('button', { name: 'Add step after log' }).click();
    await page.getByTestId('step-picker-agent-toolkit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Toolkit Capabilities')).toBeVisible();
    const search = page.getByPlaceholder('Search steps or operations...');

    await search.fill('alpha');
    await expect(dialog.getByText('Toolkit Capabilities')).toHaveCount(0);
    await search.fill('');

    await knownDefect('ED-28', async () => {
      await expect(dialog.getByText('Toolkit Capabilities')).toBeVisible();
      await expect(dialog.getByText('Step Types', { exact: true })).toHaveCount(
        0
      );
    });
  });

  test('ED-29 A disabled agent is never held by the picker, so nothing is dropped on close', async ({
    page,
    mockApi,
  }) => {
    let allowed = ['toolkit', 'memstore'];
    const wf = graphWorkflow(
      'wf_ed29',
      'worker',
      graphWorkflowSteps(agentStep('cap-a'))
    );
    await open(page, mockApi, wf, () =>
      page.route(api('entitlements'), (route) =>
        json(route, ENTITLEMENTS(allowed))
      )
    );

    // Control: an enabled agent is held, and survives close.
    let panel = await openPanel(page, 'Worker');
    await panel.getByRole('button', { name: 'Toolkit → cap-a' }).click();
    await expect(
      page.getByRole('dialog').getByText('Select Capability')
    ).toBeVisible();
    expect(await pickerSelectedAgent(page)).toMatchObject({
      found: true,
      selectedAgent: { id: 'toolkit' },
    });
    await page.keyboard.press('Escape');
    await panel.getByRole('button', { name: 'Toolkit → cap-a' }).click();
    expect((await pickerSelectedAgent(page)).selectedAgent).toMatchObject({
      id: 'toolkit',
    });

    // The agent is now disabled for the tenant.
    allowed = ['memstore'];
    await page.reload();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({
      timeout: 15_000,
    });
    panel = await openPanel(page, 'Worker');
    const subtitle = panel.getByRole('button', { name: /toolkit → cap-a/i });
    await subtitle.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Select Capability')).toBeVisible();
    await expect(dialog.getByText('Memstore')).toBeVisible();
    await expect(dialog.getByText('Toolkit')).toHaveCount(0);

    // Null before any close: getAgents already filtered it from rawAgents.
    expect(await pickerSelectedAgent(page)).toEqual({
      found: true,
      selectedAgent: null,
    });
    await page.keyboard.press('Escape');
    await subtitle.click();
    await expect(dialog.getByText('Select Capability')).toBeVisible();
    expect(await pickerSelectedAgent(page)).toEqual({
      found: true,
      selectedAgent: null,
    });
  });

  test('ED-30 AI Agent memory offers a configure or cancel step before it stays in the store', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow('wf_ed30', 'brain', { brain: AI_AGENT });
    const ctl = await open(page, mockApi, wf);
    await page.locator('.react-flow__controls-fitview').click();
    await expect(page.getByTitle('No changes to save')).toBeVisible();

    await page.getByRole('button', { name: 'Add memory to Brain' }).click();
    await page.getByTestId('step-picker-agent-memstore').click();

    // The pick has been handled once the picker has gone.
    await expect(page.getByTestId('step-picker-agent-memstore')).toHaveCount(0);
    const prompted =
      (await page.getByRole('dialog').count()) > 0 ||
      (await page.getByTestId('node-config-dialog').count()) > 0;
    const nodes = await storeNodes(page);
    const provider = nodes.find((n: any) => n.id !== 'brain');

    // Correct if the pick prompts, or waits to write, or if Cancel backs it out.
    let kept: string[] = [];
    if (!prompted && provider) {
      await expect(page.getByTitle('Save changes')).toBeEnabled();
      const brain = nodes.find((n: any) => n.id === 'brain');
      expect(brain.inputMapping.map((i: any) => i.type)).toEqual(
        expect.arrayContaining([
          'memoryEnabled',
          'memoryProviderStepId',
          'memoryConversationId',
        ])
      );
      expect(provider.id).toContain('memstore');

      const panel = await openAiPanel(page);
      await expect(panel.getByText('Conversation ID *')).toBeVisible();
      await panel.getByRole('button', { name: 'Cancel' }).click();
      const discard = page.getByRole('button', { name: 'Discard' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
      await expect(panel).toHaveCount(0);
      kept = (await storeNodes(page)).map((n: any) => n.id);
      expect(ctl.saves()).toBe(0);

      // Side finding: filling the only visible field still cannot be applied.
      // The hard-coded empty `messages` reference on the hidden provider trips
      // E011, so no save payload is reachable from this flow.
      const again = await openAiPanel(page);
      await again
        .getByRole('button', { name: 'Click to select a variable...' })
        .click();
      await page
        .getByRole('dialog', { name: 'Select Variable' })
        .getByRole('button', { name: /^data / })
        .click();
      await again.getByTestId('node-config-save').click();
      await expect(
        page
          .getByTestId('validation-message')
          .getByText(new RegExp(`'${provider.id}' has invalid reference path`))
      ).toBeVisible({ timeout: 10_000 });
      await expect(again).toBeVisible();
      expect(ctl.saves()).toBe(0);
    }

    await knownDefect('ED-30', async () => {
      expect(kept).not.toContain(provider?.id);
    });
  });

  test('ED-31 A late test response for an old capability does not populate results for the new one', async ({
    page,
    mockApi,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let testedUrl = '';
    const wf = graphWorkflow(
      'wf_ed31',
      'worker',
      graphWorkflowSteps(agentStep('cap-a'))
    );
    await open(page, mockApi, wf, () =>
      page.route(
        /\/agents\/toolkit\/capabilities\/[^/]+\/test/,
        async (route) => {
          testedUrl = route.request().url();
          await held;
          await json(route, {
            success: true,
            output: { from: 'OLD-CAP-A-OUTPUT' },
          });
        }
      )
    );
    const panel = await openPanel(page, 'Worker');
    await panel.getByRole('tab', { name: 'Testing' }).click();
    await panel.getByRole('button', { name: 'Run Test' }).click();
    await expect.poll(() => testedUrl).toContain('/capabilities/cap-a/test');

    await panel.getByRole('button', { name: 'Toolkit → cap-a' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Toolkit/ }).click();
    await dialog.getByRole('button', { name: /Beta Cap/ }).click();
    await expect(
      panel.getByRole('button', { name: 'Toolkit → cap-b' })
    ).toBeVisible();
    await expect(panel.getByText('Test Successful')).toHaveCount(0);

    const answered = page.waitForResponse(/\/capabilities\/cap-a\/test/);
    release();

    // Results are absent before the response too, so wait until it has landed.
    await answered;
    await page.waitForTimeout(500);
    await expect(
      panel.getByRole('button', { name: 'Toolkit → cap-b' })
    ).toBeVisible();
    await knownDefect('ED-31', async () => {
      await expect(
        panel.locator('textarea, pre').filter({ hasText: 'OLD-CAP-A-OUTPUT' })
      ).toHaveCount(0);
      await expect(panel.getByText('Test Successful')).toHaveCount(0);
    });
  });

  test('ED-32 Invalid on-wait JSON blocks Save', async ({ page, mockApi }) => {
    const wf = graphWorkflow('wf_ed32', 'w', {
      w: {
        id: 'w',
        stepType: 'WaitForSignal',
        name: 'Waiter',
        onWait: { steps: {}, executionPlan: [] },
        renderingParameters: { x: 100, y: 100 },
      },
    });
    const ctl = await open(page, mockApi, wf);
    const panel = await openPanel(page, 'Waiter');
    await panel.getByRole('button', { name: 'Advanced Settings' }).click();
    const text = panel.getByPlaceholder('{"steps": {}, "executionPlan": []}');
    await text.fill('{"steps":{},"executionPlan":[],"marker":"last-valid"}');
    await text.fill('{"steps": not json');
    await expect(panel.getByText(/is not valid JSON/)).toBeVisible();

    // Try both Saves as far as the UI allows; refusing either one is correct.
    await panel.getByTestId('node-config-save').click();
    const applied = await panel
      .waitFor({ state: 'detached', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (applied) {
      const button = page.getByTitle('Save changes');
      const dirty = await button
        .waitFor({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (dirty && (await button.isEnabled())) await save(page, ctl);
    }

    await knownDefect('ED-32', async () => {
      expect(ctl.saves()).toBe(0);
    });
  });

  test('ED-33 Discarding an AI Agent edit leaves conversation_id on the provider unchanged', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, memoryWorkflow('wf_ed33'));
    const provider = async () =>
      (await storeNodes(page))
        .find((n: any) => n.id === 'mem')
        ?.inputMapping.find((i: any) => i.type === 'conversation_id');
    expect((await provider()).value).toBe('conv-saved');
    await expect(page.getByTitle('No changes to save')).toBeVisible();

    const panel = await openAiPanel(page);
    const conv = panel.getByPlaceholder('data.sessionId');
    await expect(conv).toHaveValue('conv-saved');
    await conv.fill('conv-draft');
    await expect(conv).toHaveValue('conv-draft');

    await panel.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(panel).toHaveCount(0);

    // Discard does revert the agent's own copy.
    const agent = (await storeNodes(page))
      .find((n: any) => n.id === 'brain')
      ?.inputMapping.find((i: any) => i.type === 'memoryConversationId');
    expect(agent.value).toBe('conv-saved');

    await knownDefect('ED-33', async () => {
      await expect
        .poll(async () => (await provider()).value)
        .toBe('conv-saved');
    });
  });

  test('ED-34 Removing an earlier iteration row does not move the open editor to a different row', async ({
    page,
    mockApi,
  }) => {
    const variable = (m: string) => ({
      valueType: 'composite',
      type: 'object',
      value: { [m]: { valueType: 'immediate', value: m } },
    });
    const wf = graphWorkflow('wf_ed34', 'loop', {
      loop: {
        id: 'loop',
        stepType: 'While',
        name: 'Loop',
        condition: COND,
        config: {
          maxIterations: 3,
          variables: {
            a: variable('aaa'),
            b: variable('bbb'),
            c: variable('ccc'),
          },
        },
        subgraph: {
          name: 'x',
          entryPoint: 'i',
          steps: { i: LOG('i', 10) },
          executionPlan: [],
        },
        renderingParameters: { x: 100, y: 100, width: 300, height: 200 },
      },
    });
    await open(page, mockApi, wf);
    await page.locator('.react-flow__controls-fitview').click();
    await canvasStep(page, 'Loop')
      .first()
      .dblclick({ position: { x: 6, y: 6 } });
    const panel = page.getByTestId('node-config-dialog');
    await expect(panel).toBeVisible();
    const names = panel.getByRole('textbox', { name: 'variableName' });
    await expect(names).toHaveCount(3);
    const rows = panel.locator('tbody tr');
    const editorValue = panel.getByRole('textbox', { name: 'Enter value...' });
    await expect(names.nth(1)).toHaveValue('b');

    await rows.nth(1).getByRole('button', { name: 'Object · 1 field' }).click();
    await expect(editorValue).toHaveCount(1);
    await expect(editorValue).toHaveValue('bbb');

    // Row "a" is removed; the editor was open on "b".
    await rows.nth(0).locator('td').last().getByRole('button').click();

    await expect(names).toHaveCount(2);
    await expect(names.nth(0)).toHaveValue('b');
    await expect(names.nth(1)).toHaveValue('c');
    // Staying on "b" or closing are both fine; showing "c" is not.
    await knownDefect('ED-34', async () => {
      const shown = await editorValue.evaluateAll((els) =>
        els.map((el) => (el as HTMLInputElement).value)
      );
      expect(shown).not.toContain('ccc');
    });
  });

  test('ED-35 The JSON view toggle is disabled while forced by invalid JSON', async ({
    page,
    mockApi,
  }) => {
    await open(page, mockApi, logWorkflow('wf_ed35'));
    await page.locator('.react-flow__controls-fitview').click();
    await page
      .locator('[data-testid="workflow-canvas-node"]')
      .first()
      .dblclick();
    const panel = page.getByTestId('node-config-dialog');
    await panel.getByRole('button', { name: 'Edit as JSON' }).click();
    await expect(
      panel.getByRole('button', { name: 'Hide JSON' })
    ).toBeEnabled();
    const text = panel.getByPlaceholder(/caseId/);

    await text.fill('{bad');

    // Scenario reached: the structured view is forced off.
    await expect(panel.getByText('not a simple mapping object')).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Edit as JSON' })
    ).toBeDisabled();
    await expect(text).toHaveValue('{bad');
  });

  test('ED-36 An edit records undo history while the history code exists', async ({
    page,
    mockApi,
  }) => {
    const wf = graphWorkflow(
      'wf_ed36',
      'a',
      { a: LOG('a', 100), b: LOG('b', 400) },
      [{ fromStep: 'a', toStep: 'b' }]
    );
    await open(page, mockApi, wf);
    const b = canvasStep(page, 'b');
    await page.locator('.react-flow__controls-fitview').click();
    await page.getByTitle('Add note').click();
    await b.click();
    await page.keyboard.press('Delete');
    await expect(b).toHaveCount(0);

    for (const key of ['Meta+z', 'Control+z', 'Meta+Shift+z', 'Control+y']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(800);

    // Two recording actions ran. Each calls saveToHistory() inside its own
    // immer `set`, and the outer set overwrites what the inner one wrote.
    // Removing the unused history code would be just as correct.
    const after = await history(page);
    await knownDefect('ED-36', async () => {
      if (after.length !== null) expect(after.length).toBeGreaterThan(0);
    });

    // Control: the probe reads the live store, and a direct call does record.
    if (after.length !== null) {
      const direct = await page.evaluate(async () => {
        const m = await import(
          '/src/features/workflows/stores/workflowStore.ts' as string
        );
        m.useWorkflowStore.getState().saveToHistory();
        return m.useWorkflowStore.getState().history.length;
      });
      expect(direct).toBeGreaterThan(after.length);
    }
  });
});

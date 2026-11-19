import { beforeEach, describe, expect, it, vi } from 'vitest';

const rust = vi.hoisted(() => ({
  validateSchemaFieldsWithRust: vi.fn(),
  validateExecutionGraphWithRust: vi.fn(),
}));
vi.mock('@/features/workflows/utils/rust-workflow-validation', () => rust);

import { executionGraphToReactFlow } from '@/features/workflows/utils/execution-graph/deserialize';
import { prepareWorkflowSave, type WorkflowSaveInput } from './save-workflow';

const result = (
  status: 'valid' | 'invalid' | 'unavailable',
  extra: Record<string, unknown> = {}
) => ({
  success: status !== 'unavailable',
  valid: status === 'valid',
  status,
  errors: [],
  warnings: [],
  message: '',
  wasmAvailable: status !== 'unavailable',
  schemaErrors: [],
  ...extra,
});

const { nodes, edges } = executionGraphToReactFlow({
  entryPoint: 'done',
  executionPlan: [],
  steps: { done: { stepType: 'Finish', id: 'done', name: 'Done' } },
});

const input = (over: Partial<WorkflowSaveInput> = {}): WorkflowSaveInput => ({
  name: 'Orders',
  data: { name: 'Orders', description: 'Sync orders', memoryMb: 256 },
  staged: {},
  isDirty: true,
  nodes,
  edges,
  ...over,
});

beforeEach(() => {
  rust.validateSchemaFieldsWithRust
    .mockReset()
    .mockResolvedValue(result('valid'));
  rust.validateExecutionGraphWithRust
    .mockReset()
    .mockResolvedValue(result('valid'));
});

describe('prepareWorkflowSave', () => {
  it('has nothing to save when the canvas, the name and the settings are as saved', async () => {
    expect(await prepareWorkflowSave(input({ isDirty: false }))).toEqual({
      outcome: 'unchanged',
    });
    expect(rust.validateExecutionGraphWithRust).not.toHaveBeenCalled();
  });

  it.each([
    ['a changed canvas', { isDirty: true }],
    ['a changed name', { isDirty: false, name: 'Renamed' }],
    ['a staged setting', { isDirty: false, staged: { description: 'New' } }],
  ])('saves for %s alone', async (_what, over) => {
    const prepared = await prepareWorkflowSave(input(over));
    expect(prepared.outcome).toBe('ready');
  });

  it('sends the graph composed from the canvas and the merged settings', async () => {
    const prepared = await prepareWorkflowSave(
      input({
        staged: {
          description: 'Sync all orders',
          trackEvents: false,
          variables: [{ name: 'region', type: 'string', value: 'eu' }],
        },
      })
    );
    expect(prepared).toMatchObject({
      outcome: 'ready',
      warnings: [],
      request: {
        memoryMb: 256,
        trackEvents: false,
        data: {
          name: 'Orders',
          description: 'Sync all orders',
          entryPoint: 'done',
          variables: { region: { type: 'string', value: 'eu' } },
          steps: { done: { stepType: 'Finish', id: 'done', name: 'Done' } },
        },
      },
    });
    // What is validated is what is sent.
    expect(rust.validateExecutionGraphWithRust).toHaveBeenCalledWith(
      prepared.outcome === 'ready' ? prepared.request.data : undefined
    );
  });

  it('keeps the saved name when the staged one was emptied', async () => {
    const prepared = await prepareWorkflowSave(input({ staged: { name: '' } }));
    expect(prepared).toMatchObject({
      outcome: 'ready',
      request: { data: { name: 'Orders' } },
    });
  });

  it('refuses invalid schema fields before composing a graph', async () => {
    rust.validateSchemaFieldsWithRust.mockImplementation(async (label) =>
      label === 'Output schema'
        ? result('invalid', {
            errors: ['[E001] Output schema: duplicate field'],
          })
        : result('valid')
    );
    const prepared = await prepareWorkflowSave(input());
    expect(prepared).toMatchObject({
      outcome: 'invalid',
      focusFirstError: false,
    });
    expect(
      prepared.outcome === 'invalid' && prepared.messages.map((m) => m.severity)
    ).toEqual(['error']);
    expect(rust.validateExecutionGraphWithRust).not.toHaveBeenCalled();
  });

  it('reports an invalid schema by its message when it lists no errors', async () => {
    rust.validateSchemaFieldsWithRust.mockResolvedValue(
      result('invalid', { message: 'Schema fields are invalid' })
    );
    const prepared = await prepareWorkflowSave(input());
    expect(
      prepared.outcome === 'invalid' && prepared.messages.map((m) => m.message)
    ).toEqual([
      'Schema fields are invalid',
      'Schema fields are invalid',
      'Schema fields are invalid',
    ]);
  });

  it('refuses an invalid graph, with its warnings, and asks for the first error to be shown', async () => {
    rust.validateExecutionGraphWithRust.mockResolvedValue(
      result('invalid', {
        errors: ["[E010] Step 'done': missing mapping"],
        warnings: ['[W002] Unused variable'],
      })
    );
    const prepared = await prepareWorkflowSave(input());
    expect(prepared).toMatchObject({
      outcome: 'invalid',
      focusFirstError: true,
    });
    expect(
      prepared.outcome === 'invalid' && prepared.messages.map((m) => m.severity)
    ).toEqual(['error', 'warning']);
  });

  it('lets a save through with warnings', async () => {
    rust.validateExecutionGraphWithRust.mockResolvedValue(
      result('valid', { warnings: ['[W002] Unused variable'] })
    );
    const prepared = await prepareWorkflowSave(input());
    expect(prepared.outcome).toBe('ready');
    expect(
      prepared.outcome === 'ready' && prepared.warnings.map((m) => m.severity)
    ).toEqual(['warning']);
  });

  it('treats a validator that cannot run as a warning, not a refusal', async () => {
    const unavailable = result('unavailable', {
      message: 'Validation is unavailable in this browser',
    });
    rust.validateSchemaFieldsWithRust.mockResolvedValue(unavailable);
    rust.validateExecutionGraphWithRust.mockResolvedValue(unavailable);
    const prepared = await prepareWorkflowSave(input());
    expect(prepared.outcome).toBe('ready');
    // One for the graph, one for each of the three schemas.
    expect(prepared.outcome === 'ready' && prepared.warnings).toHaveLength(4);
  });
});

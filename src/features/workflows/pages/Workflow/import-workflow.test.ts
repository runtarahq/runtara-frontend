import { describe, expect, it, vi } from 'vitest';
import { parseWorkflowImport } from './import-workflow';

const graph = {
  entryPoint: 'done',
  executionPlan: [],
  steps: { done: { stepType: 'Finish', id: 'done', name: 'Done' } },
};

const read = (value: unknown) => {
  const imported = parseWorkflowImport(JSON.stringify(value));
  if (!imported.ok) throw new Error(`not imported: ${imported.reason}`);
  return imported;
};

describe('parseWorkflowImport', () => {
  it("reads an export: the graph for the canvas, the wrapper's settings to stage", () => {
    const imported = read({
      name: 'Orders',
      description: 'Sync orders',
      memoryMb: 512,
      trackEvents: false,
      executionGraph: {
        ...graph,
        executionTimeoutSeconds: 120,
        rateLimitBudgetMs: 5000,
      },
    });
    expect(imported.executionGraph.steps).toEqual(graph.steps);
    expect(imported.settings).toMatchObject({
      name: 'Orders',
      description: 'Sync orders',
      memoryMb: 512,
      trackEvents: false,
      executionTimeoutSeconds: 120,
      rateLimitBudgetMs: 5000,
      entryPoint: 'done',
    });
  });

  it('reads a bare execution graph, with its own name', () => {
    const imported = read({ ...graph, name: 'From the graph' });
    expect(imported.executionGraph.entryPoint).toBe('done');
    expect(imported.settings.name).toBe('From the graph');
  });

  it("takes the wrapper's name and description over the graph's", () => {
    const imported = read({
      name: 'Wrapper',
      description: 'Outside',
      executionGraph: { ...graph, name: 'Graph', description: 'Inside' },
    });
    expect(imported.settings).toMatchObject({
      name: 'Wrapper',
      description: 'Outside',
    });
  });

  it("takes the graph's durable over the wrapper's, and keeps an explicit null", () => {
    expect(
      read({ durable: true, executionGraph: { ...graph, durable: false } })
        .settings.durable
    ).toBe(false);
    expect(
      read({ durable: true, executionGraph: graph }).settings.durable
    ).toBe(true);
    expect(read({ ...graph, durable: null }).settings.durable).toBeNull();
  });

  it('stages nothing for a setting the file does not carry', () => {
    const { settings } = read(graph);
    for (const key of [
      'name',
      'description',
      'durable',
      'memoryMb',
      'trackEvents',
      'executionTimeoutSeconds',
      'rateLimitBudgetMs',
    ]) {
      expect(settings).not.toHaveProperty(key);
    }
  });

  it('always stages variables and schemas, empty when the graph has none', () => {
    expect(read(graph).settings).toMatchObject({
      variables: [],
      inputSchemaFields: [],
      outputSchemaFields: [],
      stateSchemaFields: [],
    });
  });

  it('lists the variables the graph keeps by name', () => {
    const { settings } = read({
      ...graph,
      variables: {
        region: { type: 'string', value: 'eu', description: 'Where' },
        limit: { type: 'number', value: 10 },
        // A variable stored as a bare value, from an old export.
        legacy: 'plain',
      },
    });
    expect(settings.variables).toEqual([
      { name: 'region', type: 'string', value: 'eu', description: 'Where' },
      { name: 'limit', type: 'number', value: 10, description: null },
      { name: 'legacy', type: 'string', value: 'plain', description: null },
    ]);
  });

  it('reads schema fields with their defaults, and no state field required', () => {
    const { settings } = read({
      ...graph,
      inputSchema: {
        orderId: { type: 'string', required: true },
        note: { type: 'string' },
      },
      stateSchema: { status: { type: 'string', required: true } },
    });
    expect(settings.inputSchemaFields).toEqual([
      expect.objectContaining({
        name: 'orderId',
        type: 'string',
        required: true,
        description: '',
      }),
      // The DSL's own default: a field that does not say is not required.
      expect.objectContaining({ name: 'note', required: false }),
    ]);
    expect(settings.stateSchemaFields).toEqual([
      expect.objectContaining({ name: 'status', required: false }),
    ]);
  });

  it('reads the memory of an export from before it was a number', () => {
    const imported = read({ memoryTier: 'M', executionGraph: graph });
    expect(typeof imported.settings.memoryMb).toBe('number');
    // An explicit number wins over a tier.
    expect(
      read({ memoryMb: 300, memoryTier: 'M', executionGraph: graph }).settings
        .memoryMb
    ).toBe(300);
  });

  it('refuses JSON that is no execution graph', () => {
    expect(parseWorkflowImport('{"name":"Orders"}')).toEqual({
      ok: false,
      reason: 'not-a-graph',
    });
    expect(parseWorkflowImport('{"executionGraph":{"name":"x"}}')).toEqual({
      ok: false,
      reason: 'not-a-graph',
    });
  });

  it('refuses text that is not JSON', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseWorkflowImport('not json')).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(parseWorkflowImport('null')).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    logged.mockRestore();
  });

  it('accepts a graph with a plan and no steps', () => {
    expect(read({ executionPlan: [] }).executionGraph).toEqual({
      executionPlan: [],
    });
  });
});

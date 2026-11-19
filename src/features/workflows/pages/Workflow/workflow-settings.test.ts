import { describe, expect, it } from 'vitest';
import {
  graphOptions,
  graphVariables,
  mergeWorkflowSettings,
  withSavedSettings,
  type WorkflowVariable,
} from './workflow-settings';

describe('mergeWorkflowSettings', () => {
  it('lays the staged settings over the saved ones', () => {
    const merged = mergeWorkflowSettings(
      { name: 'Saved', description: 'Old', executionTimeoutSeconds: 300 },
      { description: 'New', rateLimitBudgetMs: 5000 }
    );
    expect(merged).toMatchObject({
      name: 'Saved',
      description: 'New',
      executionTimeoutSeconds: 300,
      rateLimitBudgetMs: 5000,
    });
  });

  it('defaults what neither has to empty', () => {
    expect(mergeWorkflowSettings({}, {})).toEqual({
      name: '',
      description: '',
      variables: [],
      inputSchemaFields: [],
      outputSchemaFields: [],
      stateSchemaFields: [],
      executionTimeoutSeconds: undefined,
      rateLimitBudgetMs: undefined,
      durable: undefined,
      entryPoint: undefined,
      memoryMb: undefined,
      trackEvents: undefined,
    });
  });

  it('keeps a staged reset of a setting that can be switched off', () => {
    const merged = mergeWorkflowSettings(
      { durable: true, entryPoint: 'first', memoryMb: 256, trackEvents: true },
      {
        durable: null,
        entryPoint: undefined,
        memoryMb: undefined,
        trackEvents: false,
      }
    );
    expect(merged).toMatchObject({
      durable: null,
      entryPoint: undefined,
      memoryMb: undefined,
      trackEvents: false,
    });
  });

  it('keeps a staged empty list over a saved one', () => {
    const variable: WorkflowVariable = {
      name: 'region',
      type: 'string',
      value: 'eu',
    };
    const merged = mergeWorkflowSettings(
      { variables: [variable] },
      { variables: [] }
    );
    expect(merged.variables).toEqual([]);
  });
});

describe('graphVariables', () => {
  it('keys the variables by name, with a description only when there is one', () => {
    expect(
      graphVariables([
        { name: 'region', type: 'string', value: 'eu' },
        { name: 'limit', type: 'number', value: 10, description: 'Per run' },
      ])
    ).toEqual({
      region: { type: 'string', value: 'eu' },
      limit: { type: 'number', value: 10, description: 'Per run' },
    });
  });

  it('types a variable without a type as a string', () => {
    const untyped = {
      name: 'x',
      type: '',
      value: 1,
    } as unknown as WorkflowVariable;
    expect(graphVariables([untyped])).toEqual({
      x: { type: 'string', value: 1 },
    });
  });

  it('is undefined for no variables, so the graph has no key for them', () => {
    expect(graphVariables([])).toBeUndefined();
  });
});

describe('graphOptions', () => {
  it('leaves out a schema that has no fields', () => {
    const options = graphOptions(mergeWorkflowSettings({}, {}));
    expect(options.inputSchema).toBeUndefined();
    expect(options.outputSchema).toBeUndefined();
    expect(options.stateSchema).toBeUndefined();
    expect(options.variables).toBeUndefined();
  });

  it('builds the schemas and carries the graph-level settings', () => {
    const options = graphOptions(
      mergeWorkflowSettings(
        {
          description: 'Sync orders',
          executionTimeoutSeconds: 120,
          durable: false,
          entryPoint: 'first',
        },
        {
          inputSchemaFields: [
            {
              name: 'orderId',
              type: 'string',
              required: true,
              description: '',
            },
          ],
        }
      )
    );
    expect(options).toMatchObject({
      description: 'Sync orders',
      executionTimeoutSeconds: 120,
      durable: false,
      entryPoint: 'first',
    });
    expect(Object.keys(options.inputSchema ?? {})).toEqual(['orderId']);
  });
});

describe('withSavedSettings', () => {
  const loaded = {
    id: 'wf-1',
    currentVersionNumber: 3,
    executionGraph: { steps: {} },
    name: 'Orders',
    description: 'Old',
    variables: [],
    inputSchemaFields: [],
    outputSchemaFields: [],
    stateSchemaFields: [],
    durable: true,
    trackEvents: true,
  };

  it('leaves a saved workflow with its settings as the save left them', () => {
    const after = withSavedSettings(loaded, {
      name: 'Orders v2',
      durable: false,
      executionTimeoutSeconds: 60,
    });

    expect(after).toMatchObject({
      name: 'Orders v2',
      description: 'Old',
      durable: false,
      executionTimeoutSeconds: 60,
      trackEvents: true,
    });
  });

  it('keeps what is not a setting: the active version and the graph', () => {
    const after = withSavedSettings(loaded, { name: 'Renamed' });

    expect(after.id).toBe('wf-1');
    expect(after.currentVersionNumber).toBe(3);
    // The same object: the editor does not draw the graph again for a save.
    expect(after.executionGraph).toBe(loaded.executionGraph);
  });

  it('changes nothing when nothing was staged', () => {
    expect(withSavedSettings(loaded, {})).toEqual({
      ...loaded,
      executionTimeoutSeconds: undefined,
      rateLimitBudgetMs: undefined,
      entryPoint: undefined,
      memoryMb: undefined,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWorkflowHandler = vi.fn();
vi.mock('@/shared/queries', () => ({
  RuntimeREST: { api: { getWorkflowHandler } },
  createAuthHeaders: () => ({}),
}));

const { getWorkflowWorkflow } = await import('./index');

const executionGraph = {
  name: 'Orders',
  description: 'Handles orders',
  entryPoint: 'log',
  steps: {
    log: { id: 'log', stepType: 'Log', name: 'Log', message: 'hi' },
  },
  executionPlan: [],
  variables: { region: { type: 'string', value: 'eu', description: null } },
  inputSchema: { orderId: { type: 'string', required: true } },
  executionTimeoutSeconds: 30,
};

beforeEach(() => {
  getWorkflowHandler.mockReset().mockResolvedValue({
    data: {
      success: true,
      message: 'ok',
      data: {
        id: 'wf-1',
        name: 'Legacy name',
        currentVersionNumber: 3,
        executionGraph,
      },
    },
  });
});

describe('getWorkflowWorkflow', () => {
  it('keeps the graph as the server sent it, and holds no canvas nodes', async () => {
    const { data } = await getWorkflowWorkflow('wf-1', 3);

    // The editor draws the canvas from this; a query result is server state.
    expect(data.executionGraph).toEqual(executionGraph);
    expect(data).not.toHaveProperty('nodes');
    expect(data).not.toHaveProperty('edges');
    expect(getWorkflowHandler).toHaveBeenCalledWith('wf-1', {
      versionNumber: 3,
    });
  });

  it('reads the workflow’s settings out of its graph', async () => {
    const { data } = await getWorkflowWorkflow('wf-1');

    expect(getWorkflowHandler).toHaveBeenCalledWith('wf-1', undefined);
    expect(data.name).toBe('Orders');
    expect(data.description).toBe('Handles orders');
    expect(data.entryPoint).toBe('log');
    expect(data.executionTimeoutSeconds).toBe(30);
    expect(data.variables).toEqual([
      { name: 'region', value: 'eu', type: 'string', description: null },
    ]);
    expect(data.inputSchemaFields.map((field) => field.name)).toEqual([
      'orderId',
    ]);
    expect(data.currentVersionNumber).toBe(3);
  });

  it('falls back to the workflow’s own name when its graph has none', async () => {
    getWorkflowHandler.mockResolvedValue({
      data: {
        success: true,
        data: { id: 'wf-1', name: 'Legacy name', executionGraph: {} },
      },
    });

    const { data } = await getWorkflowWorkflow('wf-1');

    expect(data.name).toBe('Legacy name');
    expect(data.variables).toEqual([]);
  });
});

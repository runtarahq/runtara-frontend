import type { Node } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useValidationStore } from '@/features/workflows/stores/validationStore';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore';
import { applyStepEdit, stepEditOf } from './apply-step-edit';

const step = (id: string, data: Record<string, unknown> = {}): Node => ({
  id,
  type: 'BASIC_NODE',
  position: { x: 0, y: 0 },
  data: { id, name: id, stepType: 'Agent', inputMapping: [], ...data },
});
const nodeData = (id: string) =>
  useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data;

beforeEach(() => {
  useWorkflowStore.getState().resetState();
  useWorkflowStore.setState({
    nodes: [step('fetch'), step('send')],
    edges: [
      {
        id: 'fetch-send-source',
        source: 'fetch',
        target: 'send',
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ],
  });
});

describe('stepEditOf', () => {
  it("takes the form's own fields out of what is written to the step", () => {
    const { data, renameStepTo } = stepEditOf({
      name: 'Fetch orders',
      renameStepTo: 'fetch_orders',
      onWaitJsonError: 'Unexpected token',
      addOnWaitFlow: true,
    });
    expect(data).toEqual({ name: 'Fetch orders' });
    expect(renameStepTo).toBe('fetch_orders');
  });

  it('asks for no rename when none was staged', () => {
    expect(stepEditOf({ name: 'Fetch' }).renameStepTo).toBeUndefined();
  });
});

describe('applyStepEdit', () => {
  it('writes the edit to the step and marks the workflow edited', () => {
    const applied = applyStepEdit(
      'fetch',
      { name: 'Fetch orders', agentId: 'http' },
      undefined
    );
    expect(applied).toEqual({ savedId: 'fetch' });
    expect(nodeData('fetch')).toMatchObject({
      name: 'Fetch orders',
      agentId: 'http',
    });
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('renames the step first, and writes the edit under its new id', () => {
    const applied = applyStepEdit(
      'fetch',
      { name: 'Fetch orders' },
      'fetch_orders'
    );
    expect(applied).toEqual({ savedId: 'fetch_orders' });
    expect(nodeData('fetch')).toBeUndefined();
    expect(nodeData('fetch_orders')).toMatchObject({ name: 'Fetch orders' });
    // The edge follows the step.
    expect(useWorkflowStore.getState().edges[0].source).toBe('fetch_orders');
  });

  it('takes the problems that named the step along to its new id', () => {
    useValidationStore.getState().setMessages([
      {
        id: 'm1',
        severity: 'error',
        code: 'E010',
        message: 'Missing mapping',
        stepId: 'fetch',
        source: 'client',
        timestamp: 0,
      },
    ]);
    applyStepEdit('fetch', { name: 'Fetch orders' }, 'fetch_orders');
    expect([...useValidationStore.getState().stepsWithErrors]).toEqual([
      'fetch_orders',
    ]);
    useValidationStore.getState().clearMessages();
  });

  it('treats a rename to the id the step has as no rename', () => {
    expect(applyStepEdit('fetch', { name: 'Fetch' }, 'fetch')).toEqual({
      savedId: 'fetch',
    });
  });

  it('writes nothing when the rename is refused, and says why', () => {
    const applied = applyStepEdit('fetch', { name: 'Changed' }, 'send');
    expect(applied).toEqual({ error: expect.any(String) });
    expect(nodeData('fetch')).toMatchObject({ name: 'fetch' });
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it("copies an AI Agent's conversation id onto its memory provider", () => {
    useWorkflowStore.setState({
      nodes: [
        step('agent', { stepType: 'AiAgent' }),
        step('memory', { inputMapping: [] }),
      ],
      edges: [],
    });
    applyStepEdit(
      'agent',
      {
        inputMapping: [
          {
            type: 'memoryConversationId',
            value: 'data.sessionId',
            valueType: 'reference',
          },
          { type: 'memoryProviderStepId', value: 'memory' },
        ],
      },
      undefined
    );
    expect(nodeData('memory')?.inputMapping).toEqual([
      expect.objectContaining({
        type: 'conversation_id',
        value: 'data.sessionId',
        valueType: 'reference',
      }),
    ]);
  });
});

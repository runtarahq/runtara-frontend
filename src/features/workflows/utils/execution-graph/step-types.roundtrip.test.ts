import { describe, expect, it } from 'vitest';
import {
  STEP_TYPE_NAMES,
  type DslStepOf,
  type ExecutionGraphDto,
  type StepType,
} from '@/features/workflows/types/execution-graph';
import { composeExecutionGraph } from './serialize';
import { FORM_ONLY_STEP_FIELDS } from './serialize-steps';
import { executionGraphToReactFlow } from './deserialize';

// One step of every DSL step type, each typed as the generated client
// defines it. A step type the server adds does not compile until it has a
// fixture here, and a fixture stops compiling when the server renames or
// drops one of its fields.

const reference = (value: string) =>
  ({ valueType: 'reference', value }) as const;
const immediate = (value: unknown) =>
  ({ valueType: 'immediate', value }) as const;
const isTrue: DslStepOf<'Conditional'>['condition'] = {
  type: 'operation',
  op: 'EQ',
  arguments: [reference('data.ok'), immediate(true)],
};
// A body of one step has no plan, and the editor writes none.
const body = (id: string): DslStepOf<'Split'>['subgraph'] => ({
  entryPoint: id,
  steps: { [id]: { stepType: 'Finish', id, name: 'Done' } },
});

const STEPS: { [T in StepType]: DslStepOf<T> } = {
  Finish: {
    stepType: 'Finish',
    id: 'step',
    name: 'Finish',
    inputMapping: { result: reference('data.total') },
  },
  Agent: {
    stepType: 'Agent',
    id: 'step',
    name: 'Agent',
    agentId: 'http',
    capabilityId: 'request',
    connectionId: 'conn-1',
    inputMapping: { url: immediate('https://example.com') },
    maxRetries: 2,
    retryDelayMs: 500,
    timeoutMs: 30000,
  },
  Conditional: {
    stepType: 'Conditional',
    id: 'step',
    name: 'Conditional',
    condition: isTrue,
  },
  Split: {
    stepType: 'Split',
    id: 'step',
    name: 'Split',
    // The editor writes these two defaults out with the config.
    config: {
      value: reference('data.items'),
      parallelism: 4,
      allowNull: false,
      convertSingleValue: false,
    },
    subgraph: body('each'),
  },
  Switch: {
    stepType: 'Switch',
    id: 'step',
    name: 'Switch',
    config: {
      value: reference('data.kind'),
      cases: [{ matchType: 'EQ', match: 'a', output: { kind: 'a' } }],
      default: { kind: 'other' },
    },
  },
  EmbedWorkflow: {
    stepType: 'EmbedWorkflow',
    id: 'step',
    name: 'Embed',
    childWorkflowId: 'child',
    childVersion: 'latest',
    inputMapping: { order: reference('data.order') },
  },
  While: {
    stepType: 'While',
    id: 'step',
    name: 'While',
    condition: isTrue,
    config: { maxIterations: 5 },
    subgraph: body('again'),
  },
  Log: {
    stepType: 'Log',
    id: 'step',
    name: 'Log',
    level: 'info',
    message: 'started',
  },
  Error: {
    stepType: 'Error',
    id: 'step',
    name: 'Error',
    code: 'E_ORDER',
    message: 'The order is not valid',
    // The editor writes the category and severity out, defaults included.
    category: 'permanent',
    severity: 'error',
  },
  Filter: {
    stepType: 'Filter',
    id: 'step',
    name: 'Filter',
    config: { value: reference('data.items'), condition: isTrue },
  },
  GroupBy: {
    stepType: 'GroupBy',
    id: 'step',
    name: 'Group',
    config: { value: reference('data.items'), key: 'status' },
  },
  Delay: {
    stepType: 'Delay',
    id: 'step',
    name: 'Delay',
    durationMs: { valueType: 'immediate', value: 1000 },
  },
  WaitForSignal: {
    stepType: 'WaitForSignal',
    id: 'step',
    name: 'Wait',
    pollIntervalMs: 2000,
  },
  WaitForInstances: {
    stepType: 'WaitForInstances',
    id: 'step',
    name: 'Wait for runs',
    instanceIds: reference('data.runs'),
    mode: 'all',
  },
  SetState: {
    stepType: 'SetState',
    id: 'step',
    name: 'Set',
    values: { status: immediate('open') },
  },
  GetState: { stepType: 'GetState', id: 'step', name: 'Get' },
  AiAgent: {
    stepType: 'AiAgent',
    id: 'step',
    name: 'AI agent',
    connectionId: 'conn-1',
    config: {
      systemPrompt: immediate('You answer briefly.'),
      userPrompt: reference('data.question'),
    },
  },
};

function roundTrip(step: DslStepOf<StepType>) {
  const graph: ExecutionGraphDto = {
    name: 'fixture',
    steps: { [step.id]: step },
    executionPlan: [],
    entryPoint: step.id,
  };
  const { nodes, edges } = executionGraphToReactFlow(graph);
  const saved = composeExecutionGraph(nodes, edges, { name: 'fixture' });
  return { node: nodes.find((n) => n.id === step.id)!, saved: saved! };
}

describe('every DSL step type through the editor', () => {
  it('has a fixture for each step type the DSL defines', () => {
    expect(Object.keys(STEPS).sort()).toEqual([...STEP_TYPE_NAMES].sort());
  });

  it.each(STEP_TYPE_NAMES)('%s is saved as it was loaded', (stepType) => {
    const step = STEPS[stepType];
    const { saved } = roundTrip(step);
    expect(saved.entryPoint).toBe(step.id);
    expect(saved.steps?.[step.id]).toEqual(step);
  });

  it.each(STEP_TYPE_NAMES)(
    '%s is saved without the fields the editor keeps for its form',
    (stepType) => {
      const step = STEPS[stepType];
      const { node, saved } = roundTrip(step);
      // What the canvas node holds beyond the step's own keys is the editor's.
      const editorOnly = Object.keys(node.data).filter((key) => !(key in step));
      const savedKeys = Object.keys(saved.steps?.[step.id] ?? {});
      expect(savedKeys.filter((key) => editorOnly.includes(key))).toEqual([]);
      expect(savedKeys.sort()).toEqual(Object.keys(step).sort());
    }
  );

  it.each(STEP_TYPE_NAMES)(
    '%s is saved without any form-only field',
    (stepType) => {
      const step = STEPS[stepType];
      const graph: ExecutionGraphDto = {
        steps: { [step.id]: step },
        executionPlan: [],
        entryPoint: step.id,
      };
      const { nodes, edges } = executionGraphToReactFlow(graph);
      // A form that set every one of them, whatever the step type.
      const withFormState = nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          ...Object.fromEntries(
            FORM_ONLY_STEP_FIELDS.filter((field) => !(field in node.data)).map(
              (field) => [field, 'form state']
            )
          ),
        },
      }));
      const saved = composeExecutionGraph(withFormState, edges, {});
      const savedKeys = Object.keys(saved!.steps![step.id]);
      expect(
        savedKeys.filter((key) =>
          (FORM_ONLY_STEP_FIELDS as readonly string[]).includes(key)
        )
      ).toEqual([]);
    }
  );
});

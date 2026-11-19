import { describe, expect, it } from 'vitest';
import {
  isLegacyStartStep,
  stepInputMapping,
  stepOnWait,
  stepSubgraph,
  workflowExecutionGraph,
  type ExecutionGraphStepDto,
} from './execution-graph';

const body = {
  entryPoint: 'done',
  steps: { done: { stepType: 'Finish' as const, id: 'done' } },
};

describe('workflowExecutionGraph', () => {
  it("is the workflow's graph, typed", () => {
    const graph = workflowExecutionGraph({
      executionGraph: { name: 'Orders', ...body },
    });
    expect(graph.name).toBe('Orders');
    expect(graph.steps?.done.stepType).toBe('Finish');
  });

  it('is an empty graph for a workflow that carries none, or something else', () => {
    for (const executionGraph of [undefined, null, 'graph', 7, []]) {
      expect(workflowExecutionGraph({ executionGraph })).toEqual({});
    }
  });
});

describe('reading what only some steps have', () => {
  const split: ExecutionGraphStepDto = {
    stepType: 'Split',
    id: 'each',
    subgraph: body,
  };
  const agent: ExecutionGraphStepDto = {
    stepType: 'Agent',
    id: 'fetch',
    agentId: 'http',
    capabilityId: 'get',
    inputMapping: { url: { valueType: 'immediate', value: 'https://x' } },
  };
  const wait: ExecutionGraphStepDto = {
    stepType: 'WaitForSignal',
    id: 'wait',
    onWait: body,
  };

  it('finds the body of a container, and none on a step without one', () => {
    expect(stepSubgraph(split)?.entryPoint).toBe('done');
    expect(stepSubgraph(agent)).toBeUndefined();
  });

  it("finds a WaitForSignal's on-wait graph, and no other step's", () => {
    expect(stepOnWait(wait)?.entryPoint).toBe('done');
    expect(stepOnWait({ stepType: 'WaitForSignal', id: 'w' })).toBeUndefined();
    expect(stepOnWait(split)).toBeUndefined();
  });

  it('reads an input mapping, empty for a step type that has none', () => {
    expect(Object.keys(stepInputMapping(agent))).toEqual(['url']);
    expect(stepInputMapping(split)).toEqual({});
    expect(
      stepInputMapping({ stepType: 'Finish', id: 'f', inputMapping: null })
    ).toEqual({});
  });

  it('tells a legacy Start step, which the DSL no longer has', () => {
    expect(isLegacyStartStep({ stepType: 'Start' })).toBe(true);
    expect(isLegacyStartStep(agent)).toBe(false);
  });
});

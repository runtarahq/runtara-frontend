import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, STEP_TYPES } from '@/features/workflows/config/workflow';
import { STEP_TYPE_NAMES } from '@/features/workflows/types/execution-graph';
import { STEP_DESERIALIZERS } from '@/features/workflows/utils/execution-graph/step-deserializers';
import { STEP_SERIALIZERS } from '@/features/workflows/utils/execution-graph/step-serializers';
import { Icons } from '@/shared/components/icons';
import { StepTypeIcon } from '@/features/workflows/components/StepTypeIcon';
import { STEP_TYPE_CATALOG, resolveStepType, stepTypeTraits } from './catalog';
import { STEP_TYPE_UI } from './ui';

const sorted = (names: readonly string[]) => [...names].sort();
const everyStepType = sorted(STEP_TYPE_NAMES);

describe('the step-type tables', () => {
  it('each describe every DSL step type, and nothing else', () => {
    expect(sorted(Object.keys(STEP_TYPE_CATALOG))).toEqual(everyStepType);
    expect(sorted(Object.keys(STEP_TYPE_UI))).toEqual(everyStepType);
    expect(sorted(Object.keys(STEP_SERIALIZERS))).toEqual(everyStepType);
    expect(sorted(Object.keys(STEP_DESERIALIZERS))).toEqual(everyStepType);
  });

  it('resolve a step type by its name or the name the server shows', () => {
    expect(resolveStepType('AiAgent')).toBe('AiAgent');
    expect(resolveStepType('AI Agent')).toBe('AiAgent');
    expect(resolveStepType('Start Workflow')).toBe('EmbedWorkflow');
    expect(resolveStepType('Wait for Signal')).toBe('WaitForSignal');
    expect(resolveStepType('Set State')).toBe('SetState');
  });

  it('know no step type for a name that is none', () => {
    for (const name of ['Create', 'Start', 'Terminate', '', 'toString']) {
      expect(resolveStepType(name)).toBeUndefined();
      expect(stepTypeTraits(name)).toBeUndefined();
    }
    expect(resolveStepType(undefined)).toBeUndefined();
  });

  it('draw each step type as the node it has always been', () => {
    // The table the editor looked names up in before the catalog.
    expect(STEP_TYPES).toEqual({
      Create: NODE_TYPES.CreateNode,
      Finish: NODE_TYPES.BasicNode,
      Agent: NODE_TYPES.BasicNode,
      Conditional: NODE_TYPES.ConditionalNode,
      Split: NODE_TYPES.ContainerNode,
      While: NODE_TYPES.ContainerNode,
      Switch: NODE_TYPES.SwitchNode,
      EmbedWorkflow: NODE_TYPES.BasicNode,
      'Start Workflow': NODE_TYPES.BasicNode,
      Start: NODE_TYPES.BasicNode,
      Filter: NODE_TYPES.BasicNode,
      GroupBy: NODE_TYPES.BasicNode,
      AiAgent: NODE_TYPES.AiAgentNode,
      'AI Agent': NODE_TYPES.AiAgentNode,
      WaitForSignal: NODE_TYPES.BasicNode,
      'Wait for Signal': NODE_TYPES.BasicNode,
      WaitForInstances: NODE_TYPES.BasicNode,
      'Wait for Instances': NODE_TYPES.BasicNode,
      SetState: NODE_TYPES.BasicNode,
      'Set State': NODE_TYPES.BasicNode,
      GetState: NODE_TYPES.BasicNode,
      'Get State': NODE_TYPES.BasicNode,
      Delay: NODE_TYPES.BasicNode,
      Log: NODE_TYPES.BasicNode,
      Error: NODE_TYPES.BasicNode,
    });
  });

  it('give a durable flag and retries to the step types that take them', () => {
    const having = (trait: 'durable' | 'retries' | 'container') =>
      sorted(STEP_TYPE_NAMES.filter((name) => STEP_TYPE_CATALOG[name][trait]));
    expect(having('durable')).toEqual(
      sorted(['Agent', 'Split', 'EmbedWorkflow', 'Delay', 'AiAgent'])
    );
    expect(having('retries')).toEqual(sorted(['Agent', 'EmbedWorkflow']));
    expect(having('container')).toEqual(sorted(['Split', 'While']));
  });

  it('give a form of its own to every step not edited as an input mapping', () => {
    const generic = STEP_TYPE_NAMES.filter(
      (name) => STEP_TYPE_UI[name].FormField === null
    );
    expect(sorted(generic)).toEqual(
      sorted(['Agent', 'Conditional', 'Switch', 'EmbedWorkflow'])
    );
  });
});

describe('StepTypeIcon', () => {
  const markup = (ui: React.ReactElement) => render(ui).container.innerHTML;

  it("shows a step type's icon under its name and its display name", () => {
    const sparkles = markup(<Icons.sparkles className="size-4" />);
    expect(markup(<StepTypeIcon type="AiAgent" />)).toBe(sparkles);
    expect(markup(<StepTypeIcon type="AI Agent" />)).toBe(sparkles);
  });

  it('keeps the icons of the names that are no step type', () => {
    expect(markup(<StepTypeIcon type="Create" />)).toBe(
      markup(<Icons.add className="size-4" />)
    );
    expect(markup(<StepTypeIcon type="Start" />)).toBe(
      markup(<Icons.entryPoint className="size-4" />)
    );
    expect(markup(<StepTypeIcon type="nonsense" />)).toBe(
      markup(<Icons.gear className="size-4" />)
    );
  });
});

/**
 * The workflow DSL as the console reads and writes it.
 *
 * The step types are the server's own: `DslStep` is the `Step` union of the
 * generated runtime client, so a step type or a field the server adds or
 * renames reaches the editor as a type error, not as a silent `any`. Nothing
 * here restates what a step holds.
 *
 * What the canvas holds for a step while it is edited is something else
 * (`StepNodeData`): the DSL step with its fields unpacked for the form.
 */

import type {
  ExecutionGraph as ApiExecutionGraph,
  ExecutionPlanEdge,
  Step,
} from '@/generated/RuntaraRuntimeApi';

/** A step as the runtime's DSL defines it. */
export type DslStep = Step;

/** The DSL's step types: the discriminant of `DslStep`. */
export type StepType = DslStep['stepType'];

/** The DSL step of one type, e.g. `DslStepOf<'Split'>`. */
export type DslStepOf<T extends StepType> = Extract<DslStep, { stepType: T }>;

/** Every step type, for code that goes through them all. */
export const STEP_TYPE_NAMES = [
  'Finish',
  'Agent',
  'Conditional',
  'Split',
  'Switch',
  'EmbedWorkflow',
  'While',
  'Log',
  'Error',
  'Filter',
  'GroupBy',
  'Delay',
  'WaitForSignal',
  'WaitForInstances',
  'SetState',
  'GetState',
  'AiAgent',
] as const satisfies readonly StepType[];

// Fails to compile when the DSL has a step type the list above lacks.
type MissingStepType = Exclude<StepType, (typeof STEP_TYPE_NAMES)[number]>;
const _everyStepTypeIsListed: MissingStepType extends never ? true : never =
  true;
void _everyStepTypeIsListed;

/** Where the editor draws a step. */
export interface ExecutionGraphStepRenderingParametersDto {
  /** @format double */
  x?: number;
  /** @format double */
  y?: number;
  /** @format double */
  width?: number;
  /** @format double */
  height?: number;
}

/**
 * A DSL step as the converter carries it between the canvas and the graph:
 * with where it is drawn. The position is not part of the DSL. It is moved to
 * the graph's `nodes` before a save (`composeExecutionGraph`), and graphs saved
 * before that still have it on the step.
 */
export type ExecutionGraphStepDto = DslStep & {
  renderingParameters?: ExecutionGraphStepRenderingParametersDto;
};

/** A transition of the execution plan. */
export type ExecutionGraphTransitionDto = Partial<ExecutionPlanEdge>;

/**
 * An execution graph as the editor handles it: the DSL's, with every part
 * optional, since a graph being composed or read from an older version may
 * lack any of them.
 */
export type ExecutionGraphDto = Partial<
  Omit<ApiExecutionGraph, 'steps' | 'executionPlan'>
> & {
  steps?: Record<string, ExecutionGraphStepDto>;
  executionPlan?: ExecutionGraphTransitionDto[];
};

/**
 * The execution graph of a workflow the server returned, as the editor
 * handles a graph: every part optional (`ExecutionGraphDto`), since one saved
 * by an older version, or not finished, may lack any of them. A workflow
 * that carries no graph reads as an empty one.
 *
 * The generated client types the field as the DSL's `ExecutionGraph`
 * (scripts/generate-api-runtime-release.mjs sees to it where the server's
 * schema leaves it free-form).
 */
export function workflowExecutionGraph(workflow: {
  executionGraph?: unknown;
}): ExecutionGraphDto {
  const graph = workflow.executionGraph;
  return graph && typeof graph === 'object' && !Array.isArray(graph)
    ? (graph as ExecutionGraphDto)
    : {};
}

/**
 * Whether a step is of one DSL step type, narrowing it to that type so the
 * fields only it has can be read. The one place a step's type is compared
 * with a name: code that needs one step type's own fields asks here, and
 * code that needs to know what a step type is like asks the catalog
 * (step-types/catalog.ts).
 */
export function isStepOf<T extends StepType>(
  step: { stepType?: string } | null | undefined,
  stepType: T
): step is DslStepOf<T> {
  return step?.stepType === stepType;
}

/** The graph a step nests (a Split's or While's body), if it has one. */
export function stepSubgraph(
  step: ExecutionGraphStepDto
): ExecutionGraphDto | undefined {
  return 'subgraph' in step
    ? ((step.subgraph ?? undefined) as ExecutionGraphDto | undefined)
    : undefined;
}

/** The graph a WaitForSignal step runs while it waits, if it has one. */
export function stepOnWait(
  step: ExecutionGraphStepDto
): ExecutionGraphDto | undefined {
  return isStepOf(step, 'WaitForSignal')
    ? ((step.onWait ?? undefined) as ExecutionGraphDto | undefined)
    : undefined;
}

/** A step's input mapping, keyed by field; empty for a step type without one. */
export function stepInputMapping(
  step: ExecutionGraphStepDto
): Record<string, unknown> {
  return 'inputMapping' in step && step.inputMapping
    ? (step.inputMapping as Record<string, unknown>)
    : {};
}

/**
 * Whether a stored step is a `Start` step. The DSL has had none since the
 * entry point began to name the first real step, but graphs saved before
 * that carry one (utils/start-step-migration.ts takes it out on load).
 */
export function isLegacyStartStep(step: { stepType?: string }): boolean {
  return step.stepType === 'Start';
}

/**
 * A row of a step's input mapping as the form edits it. The DSL keeps a
 * mapping as an object keyed by field; the canvas keeps the rows, so an
 * unfinished one (no field yet, no value yet) survives until it is saved.
 */
export interface InputMappingRow {
  /** The field the row maps. */
  type: string;
  value?: unknown;
  typeHint?: string;
  valueType?: 'reference' | 'immediate' | 'composite' | 'template';
  defaultValue?: unknown;
  /** Seeded from a schema and not touched since. */
  autoSeeded?: boolean;
  [key: string]: unknown;
}

/**
 * The fields a canvas node holds for the step's form and nothing else: no DSL
 * step has them. The deserializer (or the form) puts them in `node.data`;
 * on save they are taken off, some after a step serializer has written what
 * they hold to where the DSL keeps it (`splitParallelism` to
 * `config.parallelism`).
 *
 * This is the editor's half of a node's data, apart from the step's own. A
 * form-only field is declared here, and `FORM_ONLY_STEP_FIELDS`
 * (utils/execution-graph/serialize-steps.ts) does not compile until it lists
 * it, so one cannot be added and then saved to the DSL by oversight.
 */
export interface StepFormOnlyFields {
  // Workflow- and step-level editors
  inputSchemaFields?: unknown;
  variablesFields?: unknown;
  formTabs?: unknown;
  startMode?: unknown;
  selectedTriggerId?: unknown;
  executionTimeout?: unknown;
  retryStrategy?: unknown;
  embedWorkflowConfig?: unknown;
  /** The graph-level fields of a nested graph, carried while it is drawn. */
  subgraphMeta?: unknown;
  // Split
  splitInputSchemaFields?: unknown;
  splitOutputSchemaFields?: unknown;
  splitVariablesFields?: unknown;
  splitParallelism?: unknown;
  splitSequential?: unknown;
  splitDontStopOnFailed?: unknown;
  splitMaxRetries?: unknown;
  splitRetryDelay?: unknown;
  splitTimeout?: unknown;
  splitAllowNull?: unknown;
  splitConvertSingleValue?: unknown;
  splitBatchSize?: unknown;
  // GroupBy, Filter, While
  groupByKey?: unknown;
  groupByExpectedKeys?: unknown;
  filterCondition?: unknown;
  whileCondition?: unknown;
  whileMaxIterations?: unknown;
  whileTimeout?: unknown;
  whileVariablesFields?: unknown;
}

/**
 * What a canvas node holds for a step: the DSL step's fields, unpacked for
 * the node form, beside the fields only the editor uses
 * (`StepFormOnlyFields`). The serializer turns it back into a `DslStep`.
 */
export interface StepNodeData extends StepFormOnlyFields {
  id?: string;
  name?: string | null;
  description?: string;
  stepType?: StepType | 'Start' | 'Create';
  inputMapping?: InputMappingRow[];
  agentId?: string;
  capabilityId?: string;
  connectionId?: string | null;
  breakpoint?: boolean | null;
  durable?: boolean | null;
  [key: string]: unknown;
}

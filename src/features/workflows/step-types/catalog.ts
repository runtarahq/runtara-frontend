import { NODE_TYPES, type NodeTypeId } from '../config/node-types';
import type { StepType } from '../types/execution-graph';

/**
 * What the editor knows about a step type that is not a component: how it is
 * drawn and described, and which execution settings it takes.
 *
 * `STEP_TYPE_CATALOG` has one entry per DSL step type and is typed to have
 * exactly those, so a step type the server adds does not compile until it is
 * described here. Its icon and its form are in `./ui.tsx`, and how it is read
 * from and written to the DSL in `utils/execution-graph/step-deserializers.ts`
 * and `step-serializers.ts`, all typed the same way: adding a step type is
 * filling in those four tables, and the compiler names each one that lacks
 * it.
 */
export interface StepTypeTraits {
  /** The canvas node it is drawn as. */
  nodeType: NodeTypeId;
  /**
   * The name the server's step-type list shows it under, when that is not the
   * step type itself ("AI Agent" for `AiAgent`).
   */
  displayName?: string;
  /** The label on its card, when humanizing the step type gives a wrong one. */
  label?: string;
  /** What it does, in one line, on a card with no description of its own. */
  summary?: string;
  /** The colour of its type badge. */
  badge: 'warning' | 'default' | 'secondary' | 'success' | 'muted';
  /** Whether the step takes a `durable` flag. */
  durable: boolean;
  /** Whether the step takes retries and a timeout. */
  retries: boolean;
  /** Whether it nests a graph of its own steps (and so their scope). */
  container: boolean;
  /**
   * Where the DSL keeps the step's fields, for the part of saving a step that
   * every step type shares (`serializeSteps`). All absent for a step saved
   * as its input mapping and nothing more.
   */
  /**
   * What its body sees of the data around it: `inherits` the enclosing
   * scope (a While), has an `iteration` of its own (a Split), or is
   * `undeclared` (a WaitForSignal's on-wait flow, whose schema is its own).
   */
  bodyScope?: 'inherits' | 'iteration' | 'undeclared';
  /** Calls another workflow, named by `childWorkflowId`. */
  callsWorkflow?: boolean;
  /** Ends its path: nothing follows it and it has no outputs to offer. */
  endsPath?: boolean;
  /** Takes `agentId` and `capabilityId`. */
  takesAgent?: boolean;
  /** Takes `connectionId`. */
  takesConnection?: boolean;
  /** Takes an `inputSchema` of its own. */
  takesInputSchema?: boolean;
  /** Its `timeoutMs` is a mapping of its own, not a step duration. */
  timeoutIsMapping?: boolean;
  /**
   * Fields the DSL keeps on the step itself, which the form edits as mapping
   * rows of the same name (an Error's `code`). Such a step has no
   * `inputMapping`, and a row left empty clears its field.
   */
  directFields?: readonly string[];
  /**
   * Rows with no field or no value are saved all the same, so the validator
   * reports them where the user left them.
   */
  keepsUnfinishedRows?: boolean;
}

export const STEP_TYPE_CATALOG: { [T in StepType]: StepTypeTraits } = {
  Finish: {
    nodeType: NODE_TYPES.BasicNode,
    summary: 'Completes this path.',
    badge: 'success',
    durable: false,
    retries: false,
    container: false,
    endsPath: true,
    keepsUnfinishedRows: true,
  },
  Agent: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: true,
    retries: true,
    container: false,
    takesAgent: true,
    takesConnection: true,
  },
  Conditional: {
    nodeType: NODE_TYPES.ConditionalNode,
    summary: 'Routes execution by condition.',
    badge: 'warning',
    durable: false,
    retries: false,
    container: false,
  },
  Split: {
    nodeType: NODE_TYPES.ContainerNode,
    summary: 'Runs a subgraph for each item.',
    badge: 'default',
    durable: true,
    retries: false,
    container: true,
    bodyScope: 'iteration',
    takesInputSchema: true,
  },
  Switch: {
    nodeType: NODE_TYPES.SwitchNode,
    summary: 'Routes execution by value.',
    badge: 'warning',
    durable: false,
    retries: false,
    container: false,
  },
  EmbedWorkflow: {
    nodeType: NODE_TYPES.BasicNode,
    displayName: 'Start Workflow',
    summary: 'Calls another workflow.',
    badge: 'secondary',
    durable: true,
    retries: true,
    container: false,
    callsWorkflow: true,
  },
  While: {
    nodeType: NODE_TYPES.ContainerNode,
    summary: 'Repeats its subgraph while the condition is true.',
    badge: 'default',
    durable: false,
    retries: false,
    container: true,
    bodyScope: 'inherits',
  },
  Log: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
    directFields: ['message', 'level'],
  },
  Error: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
    directFields: ['code', 'message', 'category', 'severity'],
  },
  Filter: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
  },
  GroupBy: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
  },
  Delay: {
    nodeType: NODE_TYPES.BasicNode,
    badge: 'muted',
    durable: true,
    retries: false,
    container: false,
  },
  WaitForSignal: {
    nodeType: NODE_TYPES.BasicNode,
    displayName: 'Wait for Signal',
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
    bodyScope: 'undeclared',
    timeoutIsMapping: true,
  },
  WaitForInstances: {
    nodeType: NODE_TYPES.BasicNode,
    displayName: 'Wait for Instances',
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
    timeoutIsMapping: true,
  },
  SetState: {
    nodeType: NODE_TYPES.BasicNode,
    displayName: 'Set State',
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
  },
  GetState: {
    nodeType: NODE_TYPES.BasicNode,
    displayName: 'Get State',
    badge: 'muted',
    durable: false,
    retries: false,
    container: false,
  },
  AiAgent: {
    nodeType: NODE_TYPES.AiAgentNode,
    displayName: 'AI Agent',
    label: 'AI agent',
    badge: 'muted',
    durable: true,
    retries: false,
    container: false,
    takesConnection: true,
  },
};

const BY_DISPLAY_NAME = new Map<string, StepType>(
  (Object.keys(STEP_TYPE_CATALOG) as StepType[]).flatMap((stepType) => {
    const { displayName } = STEP_TYPE_CATALOG[stepType];
    return displayName ? [[displayName, stepType] as const] : [];
  })
);

/**
 * The DSL step type a name stands for: itself, or the type the server shows
 * under that display name. `undefined` for a name that is no step type
 * (`Create`, the legacy `Start`, anything unknown).
 */
export function resolveStepType(name: unknown): StepType | undefined {
  if (typeof name !== 'string') return undefined;
  if (Object.prototype.hasOwnProperty.call(STEP_TYPE_CATALOG, name)) {
    return name as StepType;
  }
  return BY_DISPLAY_NAME.get(name);
}

/** The traits of a DSL step type by its own name; none for any other name. */
export function exactStepTypeTraits(name: unknown): StepTypeTraits | undefined {
  return typeof name === 'string' &&
    Object.prototype.hasOwnProperty.call(STEP_TYPE_CATALOG, name)
    ? STEP_TYPE_CATALOG[name as StepType]
    : undefined;
}

/** Whether a step of this type runs an agent's capability. */
export function stepTakesAgent(name: unknown): boolean {
  return exactStepTypeTraits(name)?.takesAgent === true;
}

/** Whether a step of this type calls another workflow. */
export function stepCallsWorkflow(name: unknown): boolean {
  return exactStepTypeTraits(name)?.callsWorkflow === true;
}

/** Whether a step of this type ends its path. */
export function stepEndsPath(name: unknown): boolean {
  return exactStepTypeTraits(name)?.endsPath === true;
}

/** Whether a step of this type nests a graph of its own steps. */
export function isContainerStepType(name: unknown): boolean {
  return exactStepTypeTraits(name)?.container === true;
}

/** The traits of the step type a name stands for, if it is one. */
export function stepTypeTraits(name: unknown): StepTypeTraits | undefined {
  const stepType = resolveStepType(name);
  return stepType ? STEP_TYPE_CATALOG[stepType] : undefined;
}

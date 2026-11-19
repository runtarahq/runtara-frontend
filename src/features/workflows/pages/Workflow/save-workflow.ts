import type { Edge, Node } from '@xyflow/react';
import { composeExecutionGraph } from '@/features/workflows/utils/execution-graph/serialize';
import {
  validateExecutionGraphWithRust,
  validateSchemaFieldsWithRust,
} from '@/features/workflows/utils/rust-workflow-validation';
import {
  convertClientErrors,
  convertClientWarnings,
} from '@/features/workflows/utils/validation-helpers';
import {
  graphOptions,
  mergeWorkflowSettings,
  type WorkflowChanges,
} from './workflow-settings';

type ValidationMessages = ReturnType<typeof convertClientErrors>;

/** What a save of the editor's content comes to, before anything is sent. */
export type WorkflowSavePreparation =
  /** Nothing differs from what is saved. */
  | { outcome: 'unchanged' }
  /**
   * The browser's validator refused it. `messages` are for the problems
   * panel; `focusFirstError` when one of them names a step to show.
   */
  | {
      outcome: 'invalid';
      messages: ValidationMessages;
      focusFirstError: boolean;
    }
  /** It may be sent. `warnings` are shown while it is, and after a refusal. */
  | {
      outcome: 'ready';
      request: {
        data: NonNullable<ReturnType<typeof composeExecutionGraph>> | object;
        memoryMb: WorkflowChanges['memoryMb'];
        trackEvents: WorkflowChanges['trackEvents'];
      };
      warnings: ValidationMessages;
    };

export interface WorkflowSaveInput {
  /** The name the toolbar's form submitted. */
  name: unknown;
  /** The saved workflow, as the page loaded it. */
  data: WorkflowChanges;
  /** The settings changed since. */
  staged: WorkflowChanges;
  /** Whether the canvas differs from what is saved. */
  isDirty: boolean;
  nodes: Node[];
  edges: Edge[];
}

/**
 * Everything a save does before the request: decides whether there is
 * anything to save, composes the execution graph from the canvas and the
 * settings, and runs the browser's validator over the schemas and the graph.
 *
 * It touches no store and sends nothing, so the page decides what to show and
 * the server stays the one that accepts a save. A validator that cannot run
 * is a warning, not a refusal: the state is unknown, and blocking a save on
 * it would punish the user for an environment problem.
 */
export async function prepareWorkflowSave(
  input: WorkflowSaveInput
): Promise<WorkflowSavePreparation> {
  const { name, data, staged, isDirty, nodes, edges } = input;

  const nameChanged = name !== data.name;
  const hasStagedChanges = Object.keys(staged).length > 0;
  if (!isDirty && !nameChanged && !hasStagedChanges) {
    return { outcome: 'unchanged' };
  }

  const settings = mergeWorkflowSettings(data, staged);

  const schemaValidations = await Promise.all([
    validateSchemaFieldsWithRust('Input schema', settings.inputSchemaFields),
    validateSchemaFieldsWithRust('Output schema', settings.outputSchemaFields),
    validateSchemaFieldsWithRust('State schema', settings.stateSchemaFields),
  ]);
  const schemaUnavailableWarnings = convertClientWarnings(
    schemaValidations
      .filter((result) => result.status === 'unavailable')
      .map((result) => result.message),
    nodes
  );
  const schemaErrors = schemaValidations.flatMap((result) =>
    result.status === 'invalid'
      ? result.errors.length > 0
        ? result.errors
        : [result.message]
      : []
  );
  if (schemaErrors.length > 0) {
    return {
      outcome: 'invalid',
      messages: [
        ...convertClientErrors(schemaErrors, nodes),
        ...schemaUnavailableWarnings,
      ],
      focusFirstError: false,
    };
  }

  // The graph carries the name, and a save needs one: an emptied one falls
  // back to the saved name.
  const executionGraph =
    composeExecutionGraph(nodes, edges, {
      name: staged.name || data.name || '',
      ...graphOptions(settings),
    }) ?? {};

  const graphValidation = await validateExecutionGraphWithRust(executionGraph);
  const warnings = [
    ...convertClientWarnings(
      graphValidation.warnings,
      nodes,
      graphValidation.warningGraphPaths
    ),
    ...(graphValidation.status === 'unavailable'
      ? convertClientWarnings([graphValidation.message], nodes)
      : []),
    ...schemaUnavailableWarnings,
  ];
  if (graphValidation.status === 'invalid') {
    const errors =
      graphValidation.errors.length > 0
        ? convertClientErrors(
            graphValidation.errors,
            nodes,
            graphValidation.errorGraphPaths
          )
        : convertClientErrors([graphValidation.message], nodes);
    return {
      outcome: 'invalid',
      messages: [...errors, ...warnings],
      focusFirstError: true,
    };
  }

  return {
    outcome: 'ready',
    request: {
      data: executionGraph,
      memoryMb: settings.memoryMb,
      trackEvents: settings.trackEvents,
    },
    warnings,
  };
}

import type { WorkflowData } from '@/features/workflows/components/WorkflowEditor/EditorSidebar';
import type { UIVariable } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/VariablesEditor';
import {
  buildSchemaFromFields,
  buildStateSchemaFromFields,
} from '@/features/workflows/utils/schema';

export type WorkflowVariable = UIVariable;

/** The settings of a workflow the user changed and has not saved. */
export type WorkflowChanges = Partial<
  Omit<WorkflowData, 'id' | 'entryPointOptions'>
>;

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * A workflow's settings as the editor shows, saves and exports them: the
 * saved ones (`data`) with the staged changes over them.
 *
 * A setting that can be reset or switched off (`durable`, `entryPoint`,
 * `memoryMb`, `trackEvents`) takes the staged value whenever one is staged,
 * `undefined`, `null` and `false` included; the others take it unless it is
 * absent. This is the one place that says so: the settings dialog, a save
 * and an export all read it here.
 */
export function mergeWorkflowSettings(
  data: WorkflowChanges,
  staged: WorkflowChanges
) {
  const explicit = <K extends keyof WorkflowChanges>(key: K) =>
    hasOwn(staged, key) ? staged[key] : data[key];
  return {
    name: staged.name ?? data.name ?? '',
    description: staged.description ?? data.description ?? '',
    variables: staged.variables ?? data.variables ?? [],
    inputSchemaFields: staged.inputSchemaFields ?? data.inputSchemaFields ?? [],
    outputSchemaFields:
      staged.outputSchemaFields ?? data.outputSchemaFields ?? [],
    stateSchemaFields: staged.stateSchemaFields ?? data.stateSchemaFields ?? [],
    executionTimeoutSeconds:
      staged.executionTimeoutSeconds ?? data.executionTimeoutSeconds,
    rateLimitBudgetMs: staged.rateLimitBudgetMs ?? data.rateLimitBudgetMs,
    durable: explicit('durable'),
    entryPoint: explicit('entryPoint'),
    memoryMb: explicit('memoryMb'),
    trackEvents: explicit('trackEvents'),
  };
}

export type MergedWorkflowSettings = ReturnType<typeof mergeWorkflowSettings>;

/**
 * A loaded workflow after a save of `saved`: everything it held, with its
 * settings as that save left them.
 */
export function withSavedSettings<T extends WorkflowChanges>(
  workflow: T,
  saved: WorkflowChanges
): T & MergedWorkflowSettings {
  return { ...workflow, ...mergeWorkflowSettings(workflow, saved) };
}

type GraphVariables = Record<
  string,
  { type: string; value: unknown; description?: string }
>;

/**
 * The variables as the execution graph keeps them: by name, from the list
 * the editor has. `undefined` for none, which leaves the key out.
 */
export function graphVariables(
  variables: WorkflowVariable[]
): GraphVariables | undefined {
  if (variables.length === 0) return undefined;
  const byName: GraphVariables = {};
  for (const variable of variables) {
    byName[variable.name] = {
      type: variable.type || 'string',
      value: variable.value,
      ...(variable.description ? { description: variable.description } : {}),
    };
  }
  return byName;
}

/**
 * What `composeExecutionGraph` takes from the settings, beside the name: the
 * graph-level fields of the DSL. A schema with no fields is left out.
 */
export function graphOptions(settings: MergedWorkflowSettings) {
  return {
    description: settings.description,
    variables: graphVariables(settings.variables),
    inputSchema:
      settings.inputSchemaFields.length > 0
        ? buildSchemaFromFields(settings.inputSchemaFields)
        : undefined,
    outputSchema:
      settings.outputSchemaFields.length > 0
        ? buildSchemaFromFields(settings.outputSchemaFields)
        : undefined,
    stateSchema:
      settings.stateSchemaFields.length > 0
        ? buildStateSchemaFromFields(settings.stateSchemaFields)
        : undefined,
    executionTimeoutSeconds: settings.executionTimeoutSeconds,
    rateLimitBudgetMs: settings.rateLimitBudgetMs,
    durable: settings.durable,
    entryPoint: settings.entryPoint,
  };
}

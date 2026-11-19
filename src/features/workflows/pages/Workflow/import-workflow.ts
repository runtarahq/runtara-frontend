import type { SchemaField as EditorSchemaField } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/SchemaFieldsEditor';
import type { ExecutionGraphDto } from '@/features/workflows/types/execution-graph';
import { MEMORY_PRESET_MIB } from '@/features/workflows/utils/memory';
import {
  parseSchema,
  type SchemaField,
} from '@/features/workflows/utils/schema';
import type { WorkflowChanges } from './workflow-settings';

/** What an imported file comes to. */
export type WorkflowImport =
  | {
      ok: true;
      /** The graph, for the canvas. */
      executionGraph: ExecutionGraphDto;
      /** The workflow's settings the file carries, staged over the saved ones. */
      settings: WorkflowChanges;
    }
  /** `unreadable`: not JSON. `not-a-graph`: JSON with no steps and no plan. */
  | { ok: false; reason: 'unreadable' | 'not-a-graph' };

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Schema fields as the settings editor holds them, with every default set. */
function editorSchemaFields(fields: SchemaField[]): EditorSchemaField[] {
  return fields.map((field) => ({
    ...field,
    type: field.type ?? 'string',
    required: field.required ?? true,
    description: field.description ?? '',
    properties: field.properties
      ? editorSchemaFields(field.properties)
      : undefined,
  }));
}

/**
 * Reads a workflow from an exported file's text: the graph for the canvas and
 * the settings to stage. Nothing is applied here; the page does that.
 *
 * Two shapes are read: the export's wrapper (`{ name, description,
 * executionGraph, … }`) and a bare execution graph. Where both carry a
 * setting, the wrapper's name and description win and the graph's `durable`
 * wins. A setting the file does not carry is not staged, so the saved one
 * stays; variables and schemas are always staged, empty when absent, since
 * they belong to the graph being replaced.
 */
export function parseWorkflowImport(jsonString: string): WorkflowImport {
  try {
    const parsed = JSON.parse(jsonString);
    const executionGraph = parsed.executionGraph ?? parsed;
    if (
      !executionGraph ||
      !(executionGraph.steps || executionGraph.executionPlan)
    ) {
      return { ok: false, reason: 'not-a-graph' };
    }

    // The graph keeps variables by name; the editor has a list.
    const variables = Object.entries(executionGraph.variables || {}).map(
      ([name, val]: [string, any]) => ({
        name,
        value: val?.value ?? val ?? '',
        type: val?.type ?? 'string',
        description: val?.description ?? null,
      })
    );

    const settings: WorkflowChanges = {
      variables,
      inputSchemaFields: editorSchemaFields(
        parseSchema(executionGraph.inputSchema)
      ),
      outputSchemaFields: editorSchemaFields(
        parseSchema(executionGraph.outputSchema)
      ),
      // State has no required fields; its schema builder omits `required`.
      stateSchemaFields: editorSchemaFields(
        parseSchema(executionGraph.stateSchema)
      ).map((field) => ({ ...field, required: false })),
    };
    if (parsed.name !== undefined || executionGraph.name !== undefined) {
      settings.name = parsed.name ?? executionGraph.name ?? '';
    }
    if (
      parsed.description !== undefined ||
      executionGraph.description !== undefined
    ) {
      settings.description =
        parsed.description ?? executionGraph.description ?? '';
    }
    if (executionGraph.executionTimeoutSeconds !== undefined) {
      settings.executionTimeoutSeconds = executionGraph.executionTimeoutSeconds;
    }
    if (executionGraph.rateLimitBudgetMs !== undefined) {
      settings.rateLimitBudgetMs = executionGraph.rateLimitBudgetMs;
    }
    if (hasOwn(executionGraph, 'durable')) {
      settings.durable = executionGraph.durable ?? null;
    } else if (hasOwn(parsed, 'durable')) {
      settings.durable = parsed.durable ?? null;
    }
    if (executionGraph.entryPoint !== undefined) {
      settings.entryPoint = executionGraph.entryPoint;
    }
    // Exports from before memory was a number carry a tier preset.
    const memoryMb =
      parsed.memoryMb ?? MEMORY_PRESET_MIB[parsed.memoryTier as string];
    if (memoryMb !== undefined) {
      settings.memoryMb = memoryMb;
    }
    if (parsed.trackEvents !== undefined) {
      settings.trackEvents = parsed.trackEvents;
    }

    return { ok: true, executionGraph, settings };
  } catch (error) {
    console.error('Error importing execution graph:', error);
    return { ok: false, reason: 'unreadable' };
  }
}

import { processMappingEntry } from '@/features/workflows/utils/mapping-serialization';
import type {
  ExecutionGraphStepDto,
  StepNodeData,
  StepType,
} from '@/features/workflows/types/execution-graph';
import { exactStepTypeTraits } from '@/features/workflows/step-types/catalog';
import { DURATION_FIELDS } from './field-values';
import { STEP_SERIALIZERS, serializeMappingObject } from './step-serializers';

/**
 * Fields a canvas node holds for the step's form and nothing else: the
 * deserializer (or the form) puts them in `node.data`, and no DSL step has
 * them. They are taken out before a step is saved, here and nowhere else, so
 * a new one is added to this list, not to a destructuring pattern.
 */
export const UI_ONLY_STEP_FIELDS = [
  'inputSchemaFields',
  'variablesFields',
  'splitInputSchemaFields',
  'splitOutputSchemaFields',
  'embedWorkflowConfig',
  'splitVariablesFields',
  'splitParallelism',
  'splitSequential',
  'splitDontStopOnFailed',
  'formTabs',
  'startMode',
  'selectedTriggerId',
  'executionTimeout',
  'retryStrategy',
  'subgraphMeta',
] as const;

/** A canvas node as `composeExecutionGraph` hands it over to be saved. */
export interface SerializableStepNode {
  data: StepNodeData;
  measured?: { width?: number; height?: number };
  position?: { x: number; y: number };
  subgraph?: { steps: Record<string, SerializableStepNode> } & Record<
    string,
    unknown
  >;
}

function withoutUiOnlyFields<T extends Record<string, unknown>>(data: T): T {
  const kept: Record<string, unknown> = { ...data };
  for (const field of UI_ONLY_STEP_FIELDS) delete kept[field];
  return kept as T;
}

/**
 * The canvas nodes of one graph as DSL steps (`DslStep`), each with where it
 * is drawn (`renderingParameters`, which `composeExecutionGraph` moves to the
 * graph's `nodes`).
 */
export function serializeSteps(
  steps: Record<string, SerializableStepNode> | undefined
): Record<string, ExecutionGraphStepDto> {
  const cleaned: Record<string, any> = {};

  if (!steps) {
    return {};
  }

  for (const [id, step] of Object.entries(steps)) {
    const { measured, position, subgraph } = step;
    const data: Record<string, any> = step.data;
    // Fields the form keeps under its own names, turned into the DSL's below.
    const {
      inputMapping = [],
      inputSchema,
      outputSchema,
      childWorkflowId,
      childVersion,
      splitMaxRetries,
      splitRetryDelay,
      splitTimeout,
      splitAllowNull,
      splitConvertSingleValue,
      splitBatchSize,
      groupByKey,
      groupByExpectedKeys,
      filterCondition,
      whileCondition,
      whileMaxIterations,
      whileTimeout,
      whileVariablesFields,
      ...ownData
    } = data;
    const restData = withoutUiOnlyFields(ownData);
    const traits = exactStepTypeTraits(data.stepType);

    if (subgraph) {
      data.subgraph = {
        ...(subgraph || {}),
        steps: serializeSteps(subgraph.steps),
      };
    }

    // Handle inputMapping - convert array format to object format
    let cleanedInputMapping = inputMapping;
    // console.log("[DEBUG] cleanNodeData - inputMapping for node', id, ':', inputMapping);

    // Filter out empty optional fields that shouldn't be sent to the API
    const optionalFieldsToFilterIfEmpty = [
      'agentId',
      'capabilityId',
      'connectionId',
    ];
    const filteredRestData = Object.fromEntries(
      Object.entries(restData).filter(
        ([key, value]) =>
          !(optionalFieldsToFilterIfEmpty.includes(key) && value === '')
      )
    );

    if (Array.isArray(inputMapping)) {
      const preserveInvalidMappingsForRustValidation =
        traits?.keepsUnfinishedRows === true;
      // A step with direct fields (an Error's code, a Log's level) takes them
      // from the filtered mapping, where '' is the form's "field cleared"
      // signal and must keep deleting the key. Every other consumer
      // serializes a real inputMapping object, where immediate '' is a legal
      // DSL value.
      const directFields = traits?.directFields;
      const emptyStringMeansCleared = directFields !== undefined;
      const filteredMapping = inputMapping.filter(
        ({
          type,
          value,
          valueType,
          autoSeeded,
        }: {
          type: string;
          value: any;
          valueType?: string;
          autoSeeded?: boolean;
        }) => {
          // Filter out entries with empty keys (field names)
          if (!type || type.trim() === '') {
            return preserveInvalidMappingsForRustValidation;
          }
          // Keep reference/template entries even with empty values — they're resolved at runtime
          if (valueType === 'reference' || valueType === 'template') {
            return true;
          }
          // Filter out empty optional fields
          if (value === undefined || value === null || value === '') {
            if (preserveInvalidMappingsForRustValidation) {
              return true;
            }
            if (value === null && valueType === 'immediate') {
              return true;
            }
            // Immediate '' is legal DSL: keep entries that were loaded from the
            // step JSON or explicitly authored by the user. Only drop rows the
            // editor auto-seeded from the capability/child-workflow schema and
            // that still hold their untouched empty value (autoSeeded flag set
            // at seed time, see InputMappingField auto-populate).
            return (
              !emptyStringMeansCleared &&
              value === '' &&
              valueType === 'immediate' &&
              !autoSeeded
            );
          }
          return true;
        }
      );
      const normalizedMapping = preserveInvalidMappingsForRustValidation
        ? filteredMapping.map((entry: { value?: any }) =>
            entry.value === undefined ? { ...entry, value: '' } : entry
          )
        : filteredMapping;

      // Direct fields are saved on the step, not wrapped in an inputMapping.
      if (directFields) {
        directFields.forEach((field) => {
          delete filteredRestData[field];
        });
        normalizedMapping.forEach(
          ({
            type,
            value,
            valueType,
          }: {
            type: string;
            value: any;
            valueType?: string;
          }) => {
            if (directFields.includes(type)) {
              filteredRestData[type] = value;
            } else if (type === 'context') {
              const context = serializeMappingObject(value, valueType);
              if (context && Object.keys(context).length > 0) {
                filteredRestData.context = context;
              } else {
                delete filteredRestData.context;
              }
            }
          }
        );
        cleanedInputMapping = undefined;
      } else {
        // Regular steps - flat object format with InputMapping wrapping
        const mappingObject = Object.fromEntries(
          normalizedMapping.map(processMappingEntry)
        );
        // Only include inputMapping if it has entries
        cleanedInputMapping =
          Object.keys(mappingObject).length > 0 ? mappingObject : undefined;
      }
    }

    const normalizedInputSchema =
      inputSchema &&
      typeof inputSchema === 'object' &&
      Object.keys(inputSchema).length > 0
        ? inputSchema
        : undefined;

    cleaned[id] = {
      ...filteredRestData,
      ...(normalizedInputSchema ? { inputSchema: normalizedInputSchema } : {}),
      ...(cleanedInputMapping !== undefined
        ? { inputMapping: cleanedInputMapping }
        : {}),
      renderingParameters: {
        ...measured,
        ...position,
      },
    };

    // What only some step types take (step-types/catalog.ts) is taken off
    // the others: the form's data carries it whatever the type.
    if (traits?.takesAgent && data.capabilityId) {
      cleaned[id].capabilityId = data.capabilityId;
    }

    if (!traits?.takesAgent) {
      delete cleaned[id].agentId;
      delete cleaned[id].capabilityId;
    }
    if (!traits?.takesConnection) {
      delete cleaned[id].connectionId;
    }
    if (!traits?.retries) {
      delete cleaned[id].maxRetries;
      const timeoutIsMapping = traits?.timeoutIsMapping === true;
      for (const [canonical, legacy] of DURATION_FIELDS) {
        // A Wait step's own `timeoutMs` is a mapping, not a step duration.
        if (!(timeoutIsMapping && canonical === 'timeoutMs')) {
          delete cleaned[id][canonical];
        }
        delete cleaned[id][legacy];
      }
    } else {
      for (const [canonical, legacy] of DURATION_FIELDS) {
        const value = cleaned[id][legacy] ?? cleaned[id][canonical];
        delete cleaned[id][legacy];
        if (value !== undefined && value !== null && value !== '') {
          cleaned[id][canonical] = value;
        } else {
          delete cleaned[id][canonical];
        }
      }
    }
    if (!traits?.takesInputSchema) {
      delete cleaned[id].inputSchema;
    }

    // Include processed subgraph for container steps (Split)
    // The subgraph is reconstructed by composeExecutionGraph from child nodes with parentId,
    // and processed via the recursive cleanNodeData call at lines 504-510.
    if (subgraph) {
      cleaned[id].subgraph = data.subgraph;
    }

    // What this step type adds or takes away (./step-serializers.ts).
    const stepType: unknown = restData.stepType;
    const finish =
      typeof stepType === 'string' &&
      Object.prototype.hasOwnProperty.call(STEP_SERIALIZERS, stepType)
        ? STEP_SERIALIZERS[stepType as StepType]
        : null;
    finish?.({
      step: cleaned[id],
      data,
      restData,
      inputMapping,
      subgraph,
      form: {
        inputSchema,
        outputSchema,
        childWorkflowId,
        childVersion,
        splitMaxRetries,
        splitRetryDelay,
        splitTimeout,
        splitAllowNull,
        splitConvertSingleValue,
        splitBatchSize,
        groupByKey,
        groupByExpectedKeys,
        filterCondition,
        whileCondition,
        whileMaxIterations,
        whileTimeout,
        whileVariablesFields,
      },
    });
  }

  return cleaned as Record<string, ExecutionGraphStepDto>;
}

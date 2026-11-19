import type { MappingValue } from '@/generated/RuntaraRuntimeApi';
import type {
  DslStepOf,
  ExecutionGraphTransitionDto,
  StepType,
} from '@/features/workflows/types/execution-graph';
import { convertCompositeToUIFormat } from '@/features/workflows/utils/mapping-serialization';
import {
  parseSchema,
  type SchemaField,
} from '@/features/workflows/utils/schema';
import { readDuration, mapMatchTypeFromAPI } from './field-values';

/**
 * How each step type is read from the DSL, beyond what every step shares
 * (`normalizeNodesAndEdges` in ./deserialize-steps.ts does that part: the
 * input mapping as rows, the node's type, size and position).
 *
 * A deserializer returns the fields a step type's form edits under its own
 * names (`splitParallelism` for a Split's `config.parallelism`), to be laid
 * over the step's own in `node.data`. The serializers of
 * ./step-serializers.ts turn them back.
 */

export interface StepDeserializeContext<T extends StepType = StepType> {
  /** The step's id in its graph. */
  id: string;
  /** The DSL step, as the generated client types it. */
  data: DslStepOf<T>;
  /** The step's `inputSchema`, parsed when it was stored as a string. */
  parsedInputSchema: any;
  /** The plan of the graph the step is in. */
  executionPlan: ExecutionGraphTransitionDto[];
}

type StepDeserializer<T extends StepType> = (
  ctx: StepDeserializeContext<T>
) => Record<string, unknown>;

function normalizeSchemaFieldForEditor(field: SchemaField): SchemaField {
  return {
    ...field,
    type: field.type || 'string',
    required: field.required !== false,
    description: field.description || '',
  };
}

/** A value that may have been stored as a JSON string, parsed. */
export const safeParseValue = (value: any): any => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * A mapping value's fields, whatever its variant. The generated union gives a
 * composite no `value` and an immediate no `default`, so a field read off the
 * union does not type-check, though the DSL stores each variant the same way.
 */
interface MappingFields {
  valueType?: 'reference' | 'immediate' | 'composite' | 'template';
  value?: any;
  type?: string;
  default?: unknown;
}

function mappingFields(
  value: MappingValue | null | undefined
): MappingFields | undefined {
  return (value ?? undefined) as MappingFields | undefined;
}

/**
 * The row the form edits a step's source in (`config.value` of a Split,
 * Switch, Filter or GroupBy); none while it is unset. The DSL's `type` is
 * carried as the row's hint, so a save writes it back.
 */
function sourceValueRows(value: MappingValue | null | undefined) {
  const source = mappingFields(value);
  if (!source) return [];
  return [
    {
      type: 'value',
      value: source.value,
      typeHint: source.type ?? 'auto',
      valueType: source.valueType || 'reference',
      ...(source.default !== undefined ? { defaultValue: source.default } : {}),
    },
  ];
}

/**
 * For Split steps, parse config, inputSchema and outputSchema into UI fields
 */
function deserializeSplit(
  ctx: StepDeserializeContext<'Split'>
): Record<string, unknown> {
  const { data, parsedInputSchema } = ctx;
  const config = data.config;
  // Convert config.value to inputMapping format for the UI.
  // Carry the backend `type` through so the save path can round-trip it.
  const splitInputMapping = sourceValueRows(config?.value);

  // Convert config.variables to splitVariablesFields format
  const splitVariablesFields = config?.variables
    ? Object.entries(config.variables).map(([name, varDef]) => {
        const typedVarDef = varDef as {
          valueType?: 'reference' | 'immediate' | 'composite' | 'template';
          value: unknown;
          type?: string;
        };
        const resolvedValueType:
          'reference' | 'immediate' | 'composite' | 'template' =
          typedVarDef.valueType ||
          (typeof typedVarDef.value === 'object' && typedVarDef.value !== null
            ? 'composite'
            : 'reference');

        // Keep immediates/references as-is so round-trip is lossless.
        // Composites: arrays stay arrays; object-shaped values stay objects.
        // SplitStepField renders scalars via JSON.stringify when needed, so
        // we don't need to coerce at load time.
        const resolvedValue =
          resolvedValueType === 'composite'
            ? Array.isArray(typedVarDef.value)
              ? typedVarDef.value
              : typeof typedVarDef.value === 'object' &&
                  typedVarDef.value !== null
                ? typedVarDef.value
                : {}
            : typedVarDef.value === undefined
              ? ''
              : typedVarDef.value;

        return {
          name,
          value: resolvedValue,
          // Only forward `type` when backend had it; don't synthesize a default
          // or we'll asymmetrically inject a field that wasn't there on load.
          ...(typedVarDef.type !== undefined ? { type: typedVarDef.type } : {}),
          valueType: resolvedValueType,
        };
      })
    : [];

  return {
    // Override inputMapping with config.value for Split steps
    inputMapping: splitInputMapping,
    splitInputSchemaFields: parsedInputSchema
      ? parseSchema(parsedInputSchema).map(normalizeSchemaFieldForEditor)
      : [],
    splitOutputSchemaFields: data.outputSchema
      ? parseSchema(data.outputSchema).map(normalizeSchemaFieldForEditor)
      : [],
    outputSchema: safeParseValue(data.outputSchema),
    // Config fields
    splitVariablesFields,
    splitParallelism: config?.parallelism ?? 0,
    splitSequential: config?.sequential ?? false,
    splitDontStopOnFailed: config?.dontStopOnFailed ?? false,
    splitMaxRetries: config?.maxRetries ?? undefined,
    splitRetryDelay: readDuration(config, 'retryDelayMs') ?? undefined,
    splitTimeout: readDuration(config, 'timeoutMs') ?? undefined,
    splitAllowNull: config?.allowNull ?? false,
    splitConvertSingleValue: config?.convertSingleValue ?? false,
    splitBatchSize: config?.batchSize ?? undefined,
  };
}

/**
 * For Switch steps, parse config into inputMapping format for the UI
 */
function deserializeSwitch(
  ctx: StepDeserializeContext<'Switch'>
): Record<string, unknown> {
  const { data } = ctx;
  const config = data.config;
  const switchInputMapping: any[] = [];

  // Convert config.value to value field. Carry the backend `type`
  // and `default` through so the save path can round-trip them.
  const sourceRows = sourceValueRows(config?.value);
  if (sourceRows.length > 0) {
    switchInputMapping.push(...sourceRows);
  } else {
    switchInputMapping.push({
      type: 'value',
      value: '',
      typeHint: 'auto',
      valueType: 'reference',
    });
  }

  // Convert config.cases to cases field with UI match types
  const uiCases = (config?.cases || []).map((c: any) => ({
    match: c.match,
    matchType: mapMatchTypeFromAPI(c.matchType),
    output: c.output,
    ...(c.route ? { route: c.route } : {}),
  }));
  switchInputMapping.push({
    type: 'cases',
    value: uiCases,
    typeHint: 'json',
  });

  // Convert config.default — only when the workflow authored one.
  // An absent default means "no match fails the step"; fabricating
  // a {} here would silently change semantics on the next save.
  if (config?.default !== undefined) {
    switchInputMapping.push({
      type: 'default',
      value: config.default,
      typeHint: 'json',
    });
  }

  // Detect routing mode: any case with a route field
  const hasRoutes = uiCases.some((c: any) => c.route && c.route !== '');

  return {
    inputMapping: switchInputMapping,
    ...(hasRoutes
      ? {
          switchRoutingMode: true,
        }
      : {}),
  };
}

/**
 * For Filter steps, parse config into form fields
 */
function deserializeFilter(
  ctx: StepDeserializeContext<'Filter'>
): Record<string, unknown> {
  const { data } = ctx;
  const config = data.config;
  const filterInputMapping = sourceValueRows(config?.value);

  return {
    inputMapping: filterInputMapping,
    filterCondition: config?.condition,
  };
}

/**
 * For While steps, parse condition and config into form fields
 */
function deserializeWhile(
  ctx: StepDeserializeContext<'While'>
): Record<string, unknown> {
  const { data } = ctx;
  const config = data.config;
  const whileVariablesFields = config?.variables
    ? Object.entries(config.variables).map(([name, variable]) => {
        const typedVariable = variable as {
          valueType?: 'reference' | 'immediate' | 'composite' | 'template';
          value: unknown;
          type?: string;
        };
        const valueType =
          typedVariable.valueType ||
          (typeof typedVariable.value === 'object' &&
          typedVariable.value !== null
            ? 'composite'
            : 'reference');
        const value =
          valueType === 'composite'
            ? Array.isArray(typedVariable.value)
              ? typedVariable.value
              : typeof typedVariable.value === 'object' &&
                  typedVariable.value !== null
                ? typedVariable.value
                : {}
            : typedVariable.value === undefined
              ? ''
              : typedVariable.value;
        return {
          name,
          value,
          ...(typedVariable.type !== undefined
            ? { type: typedVariable.type }
            : {}),
          valueType,
        };
      })
    : [];
  return {
    inputMapping: [],
    whileCondition: data.condition,
    whileMaxIterations: config?.maxIterations ?? 10,
    whileTimeout: readDuration(config, 'timeoutMs') ?? null,
    whileVariablesFields,
  };
}

/**
 * For GroupBy steps, parse config into form fields
 */
function deserializeGroupBy(
  ctx: StepDeserializeContext<'GroupBy'>
): Record<string, unknown> {
  const { data } = ctx;
  const config = data.config;
  const groupByInputMapping = sourceValueRows(config?.value);

  return {
    inputMapping: groupByInputMapping,
    groupByKey: config?.key || '',
    groupByExpectedKeys: Array.isArray(config?.expectedKeys)
      ? config.expectedKeys
      : [],
  };
}

/**
 * For AiAgent steps, parse config into form fields
 */
function deserializeAiAgent(
  ctx: StepDeserializeContext<'AiAgent'>
): Record<string, unknown> {
  const { data, id, executionPlan } = ctx;
  const config = data.config;
  const systemPrompt = mappingFields(config?.systemPrompt);
  const userPrompt = mappingFields(config?.userPrompt);
  const model = mappingFields(config?.model);
  const temperature = mappingFields(config?.temperature);
  const maxTokens = mappingFields(config?.maxTokens);
  const aiInputMapping: any[] = [];

  if (systemPrompt) {
    aiInputMapping.push({
      type: 'systemPrompt',
      value: systemPrompt.value ?? '',
      valueType: systemPrompt.valueType || 'immediate',
      typeHint: 'string',
    });
  }

  if (userPrompt) {
    aiInputMapping.push({
      type: 'userPrompt',
      value: userPrompt.value ?? '',
      valueType: userPrompt.valueType || 'immediate',
      typeHint: 'string',
    });
  }

  if (model) {
    aiInputMapping.push({
      type: 'model',
      value: model.value ?? '',
      valueType: model.valueType || 'immediate',
      typeHint: model.type || 'string',
      ...(model.valueType === 'reference' && model.default !== undefined
        ? { defaultValue: model.default }
        : {}),
    });
  }

  if (config?.maxIterations !== undefined && config.maxIterations !== null) {
    aiInputMapping.push({
      type: 'maxIterations',
      value: config.maxIterations,
      valueType: 'immediate',
      typeHint: 'integer',
    });
  }

  if (temperature) {
    aiInputMapping.push({
      type: 'temperature',
      value: temperature.value ?? '',
      valueType: temperature.valueType || 'immediate',
      typeHint: temperature.type || 'number',
      ...(temperature.valueType === 'reference' &&
      temperature.default !== undefined
        ? { defaultValue: temperature.default }
        : {}),
    });
  }

  if (maxTokens) {
    aiInputMapping.push({
      type: 'maxTokens',
      value: maxTokens.value ?? '',
      valueType: maxTokens.valueType || 'immediate',
      typeHint: maxTokens.type || 'integer',
      ...(maxTokens.valueType === 'reference' && maxTokens.default !== undefined
        ? { defaultValue: maxTokens.default }
        : {}),
    });
  }

  if (config?.maxRetries !== undefined && config.maxRetries !== null) {
    aiInputMapping.push({
      type: 'maxRetries',
      value: config.maxRetries,
      valueType: 'immediate',
      typeHint: 'integer',
    });
  }

  for (const [canonical, legacy] of [
    ['retryDelayMs', 'retryDelay'],
    ['turnTimeoutMs', 'turnTimeout'],
  ] as const) {
    const value = readDuration(config, canonical);
    if (value !== undefined && value !== null) {
      aiInputMapping.push({
        type: legacy,
        value,
        valueType: 'immediate',
        typeHint: 'integer',
      });
    }
  }

  // Memory config: deserialize config.memory into form fields
  if (config?.memory) {
    aiInputMapping.push({
      type: 'memoryEnabled',
      value: true,
      valueType: 'immediate',
      typeHint: 'boolean',
    });

    const conversationId = mappingFields(config.memory.conversationId);
    if (conversationId) {
      aiInputMapping.push({
        type: 'memoryConversationId',
        value: conversationId.value ?? '',
        valueType: conversationId.valueType || 'reference',
        typeHint: 'string',
      });
    }

    if (config.memory.compaction) {
      if (config.memory.compaction.maxMessages !== undefined) {
        aiInputMapping.push({
          type: 'memoryMaxMessages',
          value: config.memory.compaction.maxMessages,
          valueType: 'immediate',
          typeHint: 'integer',
        });
      }
      if (config.memory.compaction.strategy) {
        aiInputMapping.push({
          type: 'memoryStrategy',
          value: config.memory.compaction.strategy,
          valueType: 'immediate',
          typeHint: 'string',
        });
      }
    }

    // Find the memory provider step from execution plan
    const memoryEdge = (executionPlan || []).find(
      (e) => e.fromStep === id && e.label === 'memory'
    );
    if (memoryEdge?.toStep) {
      aiInputMapping.push({
        type: 'memoryProviderStepId',
        value: memoryEdge.toStep,
        valueType: 'immediate',
        typeHint: 'string',
      });
    }
  }

  // Build tools array from executionPlan edges with labels
  // Filter out 'memory' (memory provider) and 'onError' (error
  // route) labels — they are not tools
  const toolNames = (executionPlan || [])
    .filter(
      (e) =>
        e.fromStep === id &&
        e.label &&
        e.label !== 'next' &&
        e.label !== 'default' &&
        e.label !== 'memory' &&
        e.label !== 'onError'
    )
    .map((e) => e.label as string);

  if (toolNames.length > 0) {
    aiInputMapping.push({
      type: 'tools',
      value: toolNames,
      valueType: 'immediate',
      typeHint: 'json',
    });
  }

  // Output schema: convert Record<string, SchemaField> → SchemaField[]
  if (config?.outputSchema && typeof config.outputSchema === 'object') {
    const schemaFields = parseSchema(config.outputSchema);
    aiInputMapping.push({
      type: 'outputSchema',
      value: schemaFields.map(normalizeSchemaFieldForEditor),
      valueType: 'immediate',
      typeHint: 'json',
    });
  }

  return { inputMapping: aiInputMapping };
}

/**
 * For Delay steps, parse durationMs into inputMapping format
 */
function deserializeDelay(
  ctx: StepDeserializeContext<'Delay'>
): Record<string, unknown> {
  const { data } = ctx;
  const delayStep = data as any;
  const duration = delayStep.durationMs;
  return {
    inputMapping: [
      {
        type: 'durationMs',
        value: duration?.value ?? '',
        valueType: duration?.valueType || 'immediate',
        typeHint: duration?.type || 'number',
        ...(duration?.default !== undefined
          ? { defaultValue: duration.default }
          : {}),
      },
    ],
  };
}

/**
 * For WaitForSignal steps, parse top-level fields into inputMapping
 */
function deserializeWaitForSignal(
  ctx: StepDeserializeContext<'WaitForSignal'>
): Record<string, unknown> {
  const { data } = ctx;
  const waitStep = data as any;
  const waitInputMapping: any[] = [];

  // Convert responseSchema (Record<string,SchemaField>) → SchemaField[]
  const schemaFields = parseSchema(waitStep.responseSchema);
  waitInputMapping.push({
    type: 'responseSchema',
    value: schemaFields.map(normalizeSchemaFieldForEditor),
    valueType: 'immediate',
    typeHint: 'json',
  });

  // Convert timeoutMs (MappingValue)
  if (waitStep.timeoutMs) {
    waitInputMapping.push({
      type: 'timeoutMs',
      value: waitStep.timeoutMs.value ?? '',
      valueType: waitStep.timeoutMs.valueType || 'immediate',
      typeHint: 'number',
    });
  } else {
    waitInputMapping.push({
      type: 'timeoutMs',
      value: '',
      valueType: 'immediate',
      typeHint: 'number',
    });
  }

  // Convert pollIntervalMs (number)
  waitInputMapping.push({
    type: 'pollIntervalMs',
    value:
      waitStep.pollIntervalMs !== undefined && waitStep.pollIntervalMs !== null
        ? String(waitStep.pollIntervalMs)
        : '',
    valueType: 'immediate',
    typeHint: 'number',
  });

  if (waitStep.action?.key) {
    waitInputMapping.push({
      type: 'actionKey',
      value: waitStep.action.key,
      valueType: 'immediate',
      typeHint: 'string',
    });
  }
  if (waitStep.action?.correlation) {
    waitInputMapping.push({
      type: 'actionCorrelation',
      value: convertCompositeToUIFormat(waitStep.action.correlation),
      valueType: 'composite',
      typeHint: 'json',
    });
  }
  if (waitStep.action?.context) {
    waitInputMapping.push({
      type: 'actionContext',
      value: convertCompositeToUIFormat(waitStep.action.context),
      valueType: 'composite',
      typeHint: 'json',
    });
  }

  return { inputMapping: waitInputMapping };
}

/**
 * For WaitForInstances steps, parse top-level fields into inputMapping
 */
function deserializeWaitForInstances(
  ctx: StepDeserializeContext<'WaitForInstances'>
): Record<string, unknown> {
  const { data } = ctx;
  const waitStep = data as any;
  const ids = waitStep.instanceIds;
  const idsValueType = ids?.valueType || 'reference';
  const idsEntry: Record<string, unknown> = {
    type: 'instanceIds',
    value:
      idsValueType === 'composite'
        ? convertCompositeToUIFormat(ids.value)
        : idsValueType === 'immediate' &&
            ids?.value !== undefined &&
            typeof ids.value !== 'string'
          ? JSON.stringify(ids.value)
          : (ids?.value ?? ''),
    valueType: idsValueType,
    typeHint: ids?.type || 'array',
  };
  if (ids?.default !== undefined) {
    idsEntry.defaultValue = ids.default;
  }
  return {
    inputMapping: [
      idsEntry,
      {
        type: 'mode',
        value: waitStep.mode ?? '',
        valueType: 'immediate',
        typeHint: 'string',
      },
      {
        type: 'timeoutMs',
        value: waitStep.timeoutMs?.value ?? '',
        valueType: waitStep.timeoutMs?.valueType || 'immediate',
        typeHint: 'number',
      },
    ],
  };
}

/**
 * For Log steps, parse top-level fields into inputMapping
 */
function deserializeLog(
  ctx: StepDeserializeContext<'Log'>
): Record<string, unknown> {
  const { data } = ctx;
  const logStep = data as any;
  const logInputMapping: any[] = [
    {
      type: 'message',
      value: logStep.message || '',
      typeHint: 'string',
      valueType: 'immediate',
    },
    {
      type: 'level',
      value: logStep.level || 'info',
      typeHint: 'string',
      valueType: 'immediate',
    },
  ];
  if (logStep.context) {
    logInputMapping.push({
      type: 'context',
      value: convertCompositeToUIFormat(logStep.context),
      typeHint: 'json',
      valueType: 'composite',
    });
  }

  return { inputMapping: logInputMapping };
}

/**
 * For Error steps, parse top-level fields into inputMapping
 */
function deserializeError(
  ctx: StepDeserializeContext<'Error'>
): Record<string, unknown> {
  const { data } = ctx;
  const errorStep = data as any;
  const errorInputMapping: any[] = [
    {
      type: 'code',
      value: errorStep.code || '',
      typeHint: 'string',
      valueType: 'immediate',
    },
    {
      type: 'message',
      value: errorStep.message || '',
      typeHint: 'string',
      valueType: 'immediate',
    },
    {
      type: 'category',
      value: errorStep.category || 'permanent',
      typeHint: 'string',
      valueType: 'immediate',
    },
    {
      type: 'severity',
      value: errorStep.severity || 'error',
      typeHint: 'string',
      valueType: 'immediate',
    },
  ];
  if (errorStep.context) {
    errorInputMapping.push({
      type: 'context',
      value: convertCompositeToUIFormat(errorStep.context),
      typeHint: 'json',
      valueType: 'composite',
    });
  }

  return { inputMapping: errorInputMapping };
}

/**
 * One entry per DSL step type, typed to have exactly those: a step type the
 * server adds does not compile until it says here how it is loaded. `null` is
 * a step whose form edits its own fields as they are.
 */
export const STEP_DESERIALIZERS: {
  [T in StepType]: StepDeserializer<T> | null;
} = {
  Finish: null,
  Agent: null,
  Conditional: null,
  EmbedWorkflow: null,
  SetState: null,
  GetState: null,
  Split: deserializeSplit,
  Switch: deserializeSwitch,
  Filter: deserializeFilter,
  While: deserializeWhile,
  GroupBy: deserializeGroupBy,
  AiAgent: deserializeAiAgent,
  Delay: deserializeDelay,
  WaitForSignal: deserializeWaitForSignal,
  WaitForInstances: deserializeWaitForInstances,
  Log: deserializeLog,
  Error: deserializeError,
};

/** The deserializer of a stored step type; none for a name that is not one. */
export function stepDeserializer(
  stepType: unknown
): StepDeserializer<StepType> | null {
  return typeof stepType === 'string' &&
    Object.prototype.hasOwnProperty.call(STEP_DESERIALIZERS, stepType)
    ? (STEP_DESERIALIZERS[
        stepType as StepType
      ] as StepDeserializer<StepType> | null)
    : null;
}

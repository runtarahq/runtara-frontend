import {
  processCompositeValue,
  processMappingEntry,
} from '@/features/workflows/utils/mapping-serialization';
import { buildSchemaFromFields } from '@/features/workflows/utils/schema';
import { convertConditionArguments } from '@/shared/utils/condition-type-conversion';
import type { StepType } from '@/features/workflows/types/execution-graph';
import { readDuration, mapMatchTypeToAPI } from './field-values';

/**
 * How each step type is written to the DSL, beyond what every step shares
 * (`serializeSteps` in ./serialize-steps.ts does that part: the name, the
 * input mapping, the execution settings).
 *
 * A serializer gets the step as built so far and finishes it in place: it
 * moves what the form kept under its own names to where the DSL has it, and
 * deletes what its step type does not take.
 */

/** The form's own names for fields the DSL nests elsewhere. */
export interface StepFormFields {
  inputSchema?: any;
  outputSchema?: any;
  childWorkflowId?: any;
  childVersion?: any;
  splitMaxRetries?: any;
  splitRetryDelay?: any;
  splitTimeout?: any;
  splitAllowNull?: any;
  splitConvertSingleValue?: any;
  splitBatchSize?: any;
  groupByKey?: any;
  groupByExpectedKeys?: any;
  filterCondition?: any;
  whileCondition?: any;
  whileMaxIterations?: any;
  whileTimeout?: any;
  whileVariablesFields?: any;
}

export interface StepSerializeContext {
  /** The DSL step being built, finished in place. */
  step: Record<string, any>;
  /** What the canvas node holds for the step (`StepNodeData`). */
  data: Record<string, any>;
  /** `data` without the editor-only fields and the form's own names. */
  restData: Record<string, any>;
  /** The rows of the form's input mapping. */
  inputMapping: any;
  /** The graph rebuilt from the node's children, when it is a container. */
  subgraph?: unknown;
  form: StepFormFields;
}

type StepSerializer = (ctx: StepSerializeContext) => void;

export function normalizeConditionExpression(condition: any): any {
  if (!condition || typeof condition !== 'object') return condition;
  if (!('op' in condition) || !Array.isArray(condition.arguments)) {
    return condition;
  }

  return {
    ...condition,
    type: condition.type || 'operation',
    arguments: convertConditionArguments(
      condition.op,
      condition.arguments,
      undefined,
      // Save path: string IN/NOT_IN right-hand sides become real arrays
      // (the runtime requires an array; a string RHS is a dead condition).
      { parseInLists: true }
    ),
  };
}

export const hasMappingValuePayload = (mappingValue: any): boolean => {
  if (!mappingValue || typeof mappingValue !== 'object') return false;
  if (!('value' in mappingValue)) return false;
  if (mappingValue.value === undefined) return false;
  if (mappingValue.value === null) {
    return mappingValue.valueType === 'immediate';
  }
  if (
    typeof mappingValue.value === 'string' &&
    mappingValue.value.trim() === ''
  ) {
    return false;
  }
  return true;
};

export const serializeSourceMappingValue = (
  mapping: any[]
): any | undefined => {
  if (!Array.isArray(mapping) || mapping.length === 0) return undefined;
  const sourceEntry =
    mapping.find((item: any) => item?.type === 'value') ?? mapping[0];
  if (!sourceEntry) return undefined;
  if (
    sourceEntry.value === undefined ||
    (typeof sourceEntry.value === 'string' && sourceEntry.value.trim() === '')
  ) {
    return undefined;
  }

  const [, sourceValue] = processMappingEntry({
    type: 'value',
    value: sourceEntry.value,
    typeHint: sourceEntry.typeHint,
    valueType: sourceEntry.valueType,
    defaultValue: sourceEntry.defaultValue,
  }) as [string, any];

  return hasMappingValuePayload(sourceValue) ? sourceValue : undefined;
};

export const parseObjectValue = (
  value: any
): Record<string, any> | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const serializeMappingObject = (
  value: any,
  valueType?: string
): Record<string, any> | undefined => {
  const objectValue = parseObjectValue(value);
  if (!objectValue) {
    return undefined;
  }

  if (valueType === 'composite') {
    const processed = processCompositeValue(objectValue);
    return processed.value &&
      typeof processed.value === 'object' &&
      !Array.isArray(processed.value)
      ? processed.value
      : undefined;
  }

  return objectValue;
};

function serializeConditional(ctx: StepSerializeContext): void {
  const { step, restData } = ctx;
  if (!(restData as any).condition) return;
  delete step.inputMapping;
  step.condition = normalizeConditionExpression((restData as any).condition);
}

function serializeDelay(ctx: StepSerializeContext): void {
  const { step, inputMapping } = ctx;
  const durationItem = Array.isArray(inputMapping)
    ? inputMapping.find((item: any) => item.type === 'durationMs')
    : undefined;
  delete step.inputMapping;
  if (durationItem?.value !== undefined && durationItem.value !== '') {
    const [, durationValue] = processMappingEntry({
      type: 'durationMs',
      value: durationItem.value,
      typeHint: durationItem.typeHint || 'number',
      valueType: durationItem.valueType || 'immediate',
      defaultValue: durationItem.defaultValue,
    }) as [string, unknown];
    step.durationMs = durationValue;
  }
}

/**
 * Ensure EmbedWorkflow has childWorkflowId and childVersion at root level (DSL v2.0.0 requirement)
 */
function serializeEmbedWorkflow(ctx: StepSerializeContext): void {
  const { step } = ctx;
  const { childWorkflowId, childVersion } = ctx.form;
  if (childWorkflowId) {
    step.childWorkflowId = childWorkflowId;
  }
  if (childVersion !== undefined) {
    // Backend ChildVersion is an untagged enum: string ("latest"/"current") or integer.
    // Convert numeric strings to integers so serde deserializes to Specific(i32).
    const v = childVersion;
    const num = Number(v);
    step.childVersion =
      typeof v === 'string' &&
      v !== '' &&
      !isNaN(num) &&
      v !== 'latest' &&
      v !== 'current'
        ? num
        : v;
  }
}

/**
 * Split step: use config instead of inputMapping, include schemas
 */
function serializeSplit(ctx: StepSerializeContext): void {
  const { step, data, restData, inputMapping } = ctx;
  const {
    splitMaxRetries,
    splitRetryDelay,
    splitTimeout,
    splitAllowNull,
    splitConvertSingleValue,
    splitBatchSize,
    outputSchema,
  } = ctx.form;
  // Remove inputMapping for Split steps - we use config instead
  delete step.inputMapping;
  const existingSplitConfig = (restData as any).config;

  // Build the config object for Split step
  const splitConfig: {
    value?: {
      valueType: 'reference' | 'immediate' | 'template' | 'composite';
      value: unknown;
      type?: string;
      default?: unknown;
    };
    parallelism?: number;
    sequential?: boolean;
    dontStopOnFailed?: boolean;
    variables?: Record<
      string,
      {
        valueType: 'reference' | 'immediate' | 'composite' | 'template';
        value: unknown;
        type?: string;
      }
    >;
    maxRetries?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    allowNull?: boolean;
    convertSingleValue?: boolean;
    batchSize?: number;
  } = {};

  const sourceValue = serializeSourceMappingValue(inputMapping);
  if (sourceValue) {
    splitConfig.value = sourceValue;
  }

  // Keep existing value if form inputMapping is temporarily empty.
  // This prevents emitting invalid Split config without the required source value.
  if (
    !splitConfig.value &&
    hasMappingValuePayload(existingSplitConfig?.value)
  ) {
    splitConfig.value = existingSplitConfig.value;
  }

  // Add execution options from the form data
  if (data.splitParallelism !== undefined && data.splitParallelism !== 0) {
    splitConfig.parallelism = data.splitParallelism;
  }
  if (data.splitSequential === true) {
    splitConfig.sequential = true;
  }
  if (data.splitDontStopOnFailed === true) {
    splitConfig.dontStopOnFailed = true;
  }
  const advancedSplitFields: Array<
    [keyof typeof splitConfig, unknown, (value: unknown) => unknown]
  > = [
    ['maxRetries', splitMaxRetries, Number],
    ['retryDelayMs', splitRetryDelay, Number],
    ['timeoutMs', splitTimeout, Number],
    ['allowNull', splitAllowNull, Boolean],
    ['convertSingleValue', splitConvertSingleValue, Boolean],
    ['batchSize', splitBatchSize, Number],
  ];
  for (const [field, formValue, coerce] of advancedSplitFields) {
    if (formValue !== undefined && formValue !== null && formValue !== '') {
      (splitConfig as any)[field] = coerce(formValue);
    } else if (existingSplitConfig?.[field] !== undefined) {
      (splitConfig as any)[field] = existingSplitConfig[field];
    } else if (
      (field === 'retryDelayMs' || field === 'timeoutMs') &&
      readDuration(existingSplitConfig, field) !== undefined
    ) {
      (splitConfig as any)[field] = readDuration(existingSplitConfig, field);
    }
  }

  // Add variables from splitVariablesFields. Route every variable through
  // the shared processMappingEntry path so templates serialize as real
  // template MappingValues, typed immediates (number/boolean) are coerced
  // from their form strings, composites are normalized to backend format,
  // and reference type hints only carry legal backend ValueTypes.
  if (
    Array.isArray(data.splitVariablesFields) &&
    data.splitVariablesFields.length > 0
  ) {
    const variables: Record<
      string,
      {
        valueType: 'reference' | 'immediate' | 'composite' | 'template';
        value: unknown;
        type?: string;
      }
    > = {};
    for (const varField of data.splitVariablesFields) {
      const variableName =
        typeof varField.name === 'string' ? varField.name.trim() : '';
      if (variableName && varField.value !== undefined) {
        const resolvedValueType:
          'reference' | 'immediate' | 'composite' | 'template' =
          varField.valueType ||
          (typeof varField.value === 'object' && varField.value !== null
            ? 'composite'
            : 'immediate');
        const [, mappingValue] = processMappingEntry({
          type: variableName,
          value: varField.value,
          typeHint: varField.type,
          valueType: resolvedValueType,
        }) as [string, (typeof variables)[string]];
        variables[variableName] = mappingValue;
      }
    }
    if (Object.keys(variables).length > 0) {
      splitConfig.variables = variables;
    }
  }

  // Backend requires config.value to exist for Split config.
  // Preserve variables/options even when source is not chosen yet by sending an empty value placeholder.
  if (
    !splitConfig.value &&
    (splitConfig.variables ||
      splitConfig.parallelism !== undefined ||
      splitConfig.sequential !== undefined ||
      splitConfig.dontStopOnFailed !== undefined ||
      splitConfig.maxRetries !== undefined ||
      splitConfig.retryDelayMs !== undefined ||
      splitConfig.timeoutMs !== undefined ||
      splitConfig.allowNull !== undefined ||
      splitConfig.convertSingleValue !== undefined ||
      splitConfig.batchSize !== undefined)
  ) {
    splitConfig.value = {
      valueType: 'reference',
      value: '',
    };
  }

  // Preserve split config when any split settings were provided.
  if (
    splitConfig.value ||
    splitConfig.variables ||
    splitConfig.parallelism !== undefined ||
    splitConfig.sequential !== undefined ||
    splitConfig.dontStopOnFailed !== undefined ||
    splitConfig.maxRetries !== undefined ||
    splitConfig.retryDelayMs !== undefined ||
    splitConfig.timeoutMs !== undefined ||
    splitConfig.allowNull !== undefined ||
    splitConfig.convertSingleValue !== undefined ||
    splitConfig.batchSize !== undefined
  ) {
    step.config = splitConfig;
  }

  // Add outputSchema if defined
  if (
    outputSchema &&
    typeof outputSchema === 'object' &&
    Object.keys(outputSchema).length > 0
  ) {
    step.outputSchema = outputSchema;
  }
}

/**
 * Switch step: use config instead of inputMapping
 */
function serializeSwitch(ctx: StepSerializeContext): void {
  const { step, inputMapping } = ctx;
  // Remove inputMapping for Switch steps - we use config instead
  delete step.inputMapping;
  delete step.switchRoutingMode;

  const switchConfig: {
    value?: {
      valueType: string;
      value: unknown;
      type?: string;
      default?: unknown;
    };
    cases?: Array<{
      match: any;
      matchType: string;
      output: any;
      route?: string;
    }>;
    default?: any;
  } = {};

  if (Array.isArray(inputMapping)) {
    // Serialize the switch value through the shared mapping path (same as
    // Split/Filter/GroupBy) so reference type hints, fallback defaults,
    // and composite values round-trip.
    const sourceValue = serializeSourceMappingValue(inputMapping);
    if (sourceValue) {
      switchConfig.value = sourceValue;
    }

    // Extract cases
    const casesItem = inputMapping.find((item: any) => item.type === 'cases');
    if (
      casesItem?.value &&
      Array.isArray(casesItem.value) &&
      casesItem.value.length > 0
    ) {
      switchConfig.cases = casesItem.value.map((c: any) => ({
        match: c.match,
        matchType: mapMatchTypeToAPI(c.matchType),
        output: c.output,
        ...(c.route ? { route: c.route } : {}),
      }));
    }

    // Extract default — only when the entry was authored. An absent
    // default means "no match is an error" at runtime, so fabricating
    // one (or persisting a cleared '') would change semantics.
    const defaultItem = inputMapping.find(
      (item: any) => item.type === 'default'
    );
    if (
      defaultItem !== undefined &&
      defaultItem.value !== undefined &&
      defaultItem.value !== ''
    ) {
      switchConfig.default = defaultItem.value;
    }
  }

  // SwitchConfig requires `value` (deny_unknown_fields + mandatory field
  // on the backend); never emit a config object lacking it.
  if (switchConfig.value) {
    step.config = switchConfig;
  }
}

/**
 * Filter step: use config instead of inputMapping
 */
function serializeFilter(ctx: StepSerializeContext): void {
  const { step, restData, inputMapping } = ctx;
  const { filterCondition } = ctx.form;
  delete step.inputMapping;
  delete step.filterCondition;
  const existingFilterConfig = (restData as any).config;

  const filterConfig: {
    value?: any;
    condition?: any;
  } = {};

  const sourceValue = serializeSourceMappingValue(inputMapping);
  if (sourceValue) {
    filterConfig.value = sourceValue;
  } else if (hasMappingValuePayload(existingFilterConfig?.value)) {
    filterConfig.value = existingFilterConfig.value;
  }

  // Add condition from form data
  if (filterCondition) {
    filterConfig.condition = normalizeConditionExpression(filterCondition);
  } else if (existingFilterConfig?.condition) {
    filterConfig.condition = normalizeConditionExpression(
      existingFilterConfig.condition
    );
  }

  // Only add config if it has the required fields
  if (filterConfig.value && filterConfig.condition) {
    step.config = filterConfig;
  }
}

/**
 * While step: serialize condition and config
 */
function serializeWhile(ctx: StepSerializeContext): void {
  const { step } = ctx;
  const {
    whileCondition,
    whileMaxIterations,
    whileTimeout,
    whileVariablesFields,
  } = ctx.form;
  delete step.inputMapping;
  delete step.whileCondition;
  delete step.whileMaxIterations;
  delete step.whileTimeout;

  // Set condition at root level (API expects WhileStep.condition)
  if (whileCondition) {
    step.condition = normalizeConditionExpression(whileCondition);
  }

  // Build config object
  const whileConfig: {
    maxIterations?: number;
    timeoutMs?: number | null;
    variables?: Record<
      string,
      {
        valueType: 'reference' | 'immediate' | 'composite' | 'template';
        value: unknown;
        type?: string;
      }
    >;
  } = {};
  if (whileMaxIterations !== undefined && whileMaxIterations !== null) {
    whileConfig.maxIterations = whileMaxIterations;
  }
  if (whileTimeout !== undefined && whileTimeout !== null) {
    whileConfig.timeoutMs = whileTimeout;
  }
  if (Array.isArray(whileVariablesFields) && whileVariablesFields.length > 0) {
    const mappedVariables: NonNullable<typeof whileConfig.variables> = {};
    for (const variableField of whileVariablesFields) {
      const variableName =
        typeof variableField.name === 'string' ? variableField.name.trim() : '';
      if (!variableName || variableField.value === undefined) continue;
      const resolvedValueType =
        variableField.valueType ||
        (typeof variableField.value === 'object' && variableField.value !== null
          ? 'composite'
          : 'immediate');
      const [, mappingValue] = processMappingEntry({
        type: variableName,
        value: variableField.value,
        typeHint: variableField.type,
        valueType: resolvedValueType,
      }) as [string, NonNullable<typeof whileConfig.variables>[string]];
      mappedVariables[variableName] = mappingValue;
    }
    if (Object.keys(mappedVariables).length > 0) {
      whileConfig.variables = mappedVariables;
    }
  }

  if (Object.keys(whileConfig).length > 0) {
    step.config = whileConfig;
  }
}

/**
 * GroupBy step: use config instead of inputMapping
 */
function serializeGroupBy(ctx: StepSerializeContext): void {
  const { step, restData, inputMapping } = ctx;
  const { groupByKey, groupByExpectedKeys } = ctx.form;
  delete step.inputMapping;
  delete step.groupByKey;
  delete step.groupByExpectedKeys;
  const existingGroupByConfig = (restData as any).config;

  const groupByConfig: {
    value?: any;
    key?: string;
    expectedKeys?: unknown[];
  } = {};

  const sourceValue = serializeSourceMappingValue(inputMapping);
  if (sourceValue) {
    groupByConfig.value = sourceValue;
  } else if (hasMappingValuePayload(existingGroupByConfig?.value)) {
    groupByConfig.value = existingGroupByConfig.value;
  }

  // Add group key from form data
  if (groupByKey) {
    groupByConfig.key = groupByKey;
  } else if (existingGroupByConfig?.key) {
    groupByConfig.key = existingGroupByConfig.key;
  }

  // Add expected keys from form data (already an array)
  if (Array.isArray(groupByExpectedKeys) && groupByExpectedKeys.length > 0) {
    groupByConfig.expectedKeys = groupByExpectedKeys;
  } else if (Array.isArray(existingGroupByConfig?.expectedKeys)) {
    groupByConfig.expectedKeys = existingGroupByConfig.expectedKeys;
  }

  // Only add config if it has the required fields
  if (groupByConfig.value && groupByConfig.key) {
    step.config = groupByConfig;
  }
}

/**
 * AiAgent step: use config instead of inputMapping
 */
function serializeAiAgent(ctx: StepSerializeContext): void {
  const { step, inputMapping } = ctx;
  delete step.inputMapping;

  const aiAgentConfig: {
    systemPrompt?: { valueType: string; value: unknown };
    userPrompt?: { valueType: string; value: unknown };
    model?: Record<string, unknown>;
    maxIterations?: number | null;
    temperature?: Record<string, unknown>;
    maxTokens?: Record<string, unknown>;
    maxRetries?: number | null;
    retryDelayMs?: number | null;
    turnTimeoutMs?: number | null;
  } = {};

  if (Array.isArray(inputMapping)) {
    const systemPromptItem = inputMapping.find(
      (item: any) => item.type === 'systemPrompt'
    );
    if (
      systemPromptItem?.value !== undefined &&
      systemPromptItem.value !== ''
    ) {
      aiAgentConfig.systemPrompt = {
        valueType: systemPromptItem.valueType || 'immediate',
        value: systemPromptItem.value,
      };
    }

    const userPromptItem = inputMapping.find(
      (item: any) => item.type === 'userPrompt'
    );
    if (userPromptItem?.value !== undefined && userPromptItem.value !== '') {
      aiAgentConfig.userPrompt = {
        valueType: userPromptItem.valueType || 'immediate',
        value: userPromptItem.value,
      };
    }

    const modelItem = inputMapping.find((item: any) => item.type === 'model');
    if (modelItem?.value) {
      const [, model] = processMappingEntry(modelItem) as [
        string,
        Record<string, unknown>,
      ];
      aiAgentConfig.model = model;
    }

    const maxIterationsItem = inputMapping.find(
      (item: any) => item.type === 'maxIterations'
    );
    if (
      maxIterationsItem?.value !== undefined &&
      maxIterationsItem.value !== ''
    ) {
      aiAgentConfig.maxIterations = Number(maxIterationsItem.value);
    }

    const temperatureItem = inputMapping.find(
      (item: any) => item.type === 'temperature'
    );
    if (temperatureItem?.value !== undefined && temperatureItem.value !== '') {
      const [, temperature] = processMappingEntry(temperatureItem) as [
        string,
        Record<string, unknown>,
      ];
      aiAgentConfig.temperature = temperature;
    }

    const maxTokensItem = inputMapping.find(
      (item: any) => item.type === 'maxTokens'
    );
    if (maxTokensItem?.value !== undefined && maxTokensItem.value !== '') {
      const [, maxTokens] = processMappingEntry(maxTokensItem) as [
        string,
        Record<string, unknown>,
      ];
      aiAgentConfig.maxTokens = maxTokens;
    }

    const maxRetriesItem = inputMapping.find(
      (item: any) => item.type === 'maxRetries'
    );
    if (maxRetriesItem?.value !== undefined && maxRetriesItem.value !== '') {
      aiAgentConfig.maxRetries = Number(maxRetriesItem.value);
    }

    const retryDelayItem = inputMapping.find(
      (item: any) => item.type === 'retryDelay'
    );
    if (retryDelayItem?.value !== undefined && retryDelayItem.value !== '') {
      aiAgentConfig.retryDelayMs = Number(retryDelayItem.value);
    }

    const turnTimeoutItem = inputMapping.find(
      (item: any) => item.type === 'turnTimeout'
    );
    if (turnTimeoutItem?.value !== undefined && turnTimeoutItem.value !== '') {
      aiAgentConfig.turnTimeoutMs = Number(turnTimeoutItem.value);
    }
  }

  // Memory config: serialize from inputMapping entries into config.memory
  const memoryEnabledItem = inputMapping.find(
    (item: any) => item.type === 'memoryEnabled'
  );
  if (memoryEnabledItem?.value === true) {
    const memoryConfig: {
      conversationId?: { valueType: string; value: unknown };
      compaction?: { maxMessages?: number; strategy?: string };
    } = {};

    const conversationIdItem = inputMapping.find(
      (item: any) => item.type === 'memoryConversationId'
    );
    // Always include conversationId when memory is enabled — backend requires it
    memoryConfig.conversationId = {
      valueType: conversationIdItem?.valueType || 'reference',
      value: conversationIdItem?.value ?? '',
    };

    const maxMessagesItem = inputMapping.find(
      (item: any) => item.type === 'memoryMaxMessages'
    );
    const strategyItem = inputMapping.find(
      (item: any) => item.type === 'memoryStrategy'
    );
    if (
      (maxMessagesItem?.value !== undefined && maxMessagesItem.value !== '') ||
      (strategyItem?.value !== undefined && strategyItem.value !== '')
    ) {
      memoryConfig.compaction = {};
      if (
        maxMessagesItem?.value !== undefined &&
        maxMessagesItem.value !== ''
      ) {
        memoryConfig.compaction.maxMessages = Number(maxMessagesItem.value);
      }
      if (strategyItem?.value) {
        memoryConfig.compaction.strategy = String(strategyItem.value);
      }
    }

    (aiAgentConfig as any).memory = memoryConfig;
  }

  // Output schema: convert SchemaField[] → Record<string, SchemaField>
  const outputSchemaItem = inputMapping.find(
    (item: any) => item.type === 'outputSchema'
  );
  if (
    outputSchemaItem?.value &&
    Array.isArray(outputSchemaItem.value) &&
    outputSchemaItem.value.length > 0
  ) {
    (aiAgentConfig as any).outputSchema = buildSchemaFromFields(
      outputSchemaItem.value
    );
  }

  step.config = aiAgentConfig;
}

/**
 * WaitForSignal step: fields are top-level (not nested under config).
 * Cleared form fields must DELETE the stale top-level key — loaded step
 * data is spread into node.data and would otherwise resurrect on save.
 * Semantics of absent keys: timeoutMs = wait indefinitely; pollIntervalMs =
 * runtime default (1000ms); responseSchema = no validation; action = none.
 */
function serializeWaitForSignal(ctx: StepSerializeContext): void {
  const { step, data, inputMapping, subgraph } = ctx;
  delete step.inputMapping;

  // Container-mode WaitForSignal: composeExecutionGraph rebuilds parented
  // children into `subgraph` (generic container path); the DSL field is
  // `onWait`. The rebuilt container is the single source of truth — it
  // overwrites any raw onWait leftover in restData. A container with no
  // children produces no subgraph, so the onWait key is removed entirely
  // (an empty onWait graph has no meaning and the empty-steps graph shape
  // is never validated/compiled).
  if (subgraph) {
    step.onWait = data.subgraph;
    delete step.subgraph;
  }

  if (Array.isArray(inputMapping)) {
    // responseSchema: convert SchemaField[] → Record<string, SchemaField>
    const responseSchemaItem = inputMapping.find(
      (item: any) => item.type === 'responseSchema'
    );
    if (
      responseSchemaItem?.value &&
      Array.isArray(responseSchemaItem.value) &&
      responseSchemaItem.value.length > 0
    ) {
      step.responseSchema = buildSchemaFromFields(responseSchemaItem.value);
    } else {
      delete step.responseSchema;
    }

    // timeoutMs: serialize as MappingValue if present. The runtime
    // (wait_timeout_ms in runtara-workflow-stdlib) requires the resolved
    // value to be a number, so only immediate (numeric) and reference
    // modes are valid — template renders to a string and composite to an
    // object, both rejected at runtime. Non-numeric immediates (e.g.
    // legacy template strings that would serialize as NaN → null) are
    // dropped instead of emitting invalid JSON.
    const timeoutItem = inputMapping.find(
      (item: any) => item.type === 'timeoutMs'
    );
    delete step.timeoutMs;
    if (timeoutItem?.value !== undefined && timeoutItem.value !== '') {
      if (timeoutItem.valueType === 'reference') {
        step.timeoutMs = {
          valueType: 'reference',
          value: timeoutItem.value,
        };
      } else {
        const timeoutNumber = Number(timeoutItem.value);
        if (Number.isFinite(timeoutNumber)) {
          step.timeoutMs = {
            valueType: 'immediate',
            value: timeoutNumber,
          };
        }
      }
    }

    // pollIntervalMs: serialize as plain integer (backend type is u64;
    // serde rejects decimals)
    const pollItem = inputMapping.find(
      (item: any) => item.type === 'pollIntervalMs'
    );
    delete step.pollIntervalMs;
    if (pollItem?.value !== undefined && pollItem.value !== '') {
      const pollNumber = Number(pollItem.value);
      if (Number.isFinite(pollNumber)) {
        step.pollIntervalMs = Math.round(pollNumber);
      }
    }

    const actionKeyItem = inputMapping.find(
      (item: any) => item.type === 'actionKey'
    );
    const actionCorrelationItem = inputMapping.find(
      (item: any) => item.type === 'actionCorrelation'
    );
    const actionContextItem = inputMapping.find(
      (item: any) => item.type === 'actionContext'
    );
    const action: Record<string, unknown> = {};
    if (actionKeyItem?.value) {
      action.key = String(actionKeyItem.value);
    }
    const correlation = serializeMappingObject(
      actionCorrelationItem?.value,
      actionCorrelationItem?.valueType
    );
    if (correlation && Object.keys(correlation).length > 0) {
      action.correlation = correlation;
    }
    const context = serializeMappingObject(
      actionContextItem?.value,
      actionContextItem?.valueType
    );
    if (context && Object.keys(context).length > 0) {
      action.context = context;
    }
    if (Object.keys(action).length > 0) {
      step.action = action;
    } else {
      delete step.action;
    }

    // onWait: the form editor sets `onWait` to undefined when blanked;
    // drop null/undefined leftovers so the key never resurrects.
    if (step.onWait == null) {
      delete step.onWait;
    }
  }
}

/**
 * WaitForInstances step: instanceIds, mode and timeoutMs are top-level
 * fields (deny_unknown_fields, no inputMapping). Cleared form fields
 * delete their key so loaded step data cannot resurrect them on save.
 * An absent mode means `all`; an absent timeoutMs means no deadline.
 */
function serializeWaitForInstances(ctx: StepSerializeContext): void {
  const { step, inputMapping } = ctx;
  delete step.inputMapping;
  delete step.durable;

  if (Array.isArray(inputMapping)) {
    const idsItem = inputMapping.find(
      (item: any) => item.type === 'instanceIds'
    );
    delete step.instanceIds;
    if (
      idsItem &&
      idsItem.value !== undefined &&
      idsItem.value !== null &&
      idsItem.value !== ''
    ) {
      // Template renders to a string, which is never a valid id list.
      if (idsItem.valueType !== 'template') {
        const [, idsValue] = processMappingEntry({
          type: 'instanceIds',
          value: idsItem.value,
          typeHint: idsItem.typeHint || 'array',
          valueType: idsItem.valueType || 'reference',
          defaultValue: idsItem.defaultValue,
        }) as [string, unknown];
        step.instanceIds = idsValue;
      }
    }

    const modeItem = inputMapping.find((item: any) => item.type === 'mode');
    delete step.mode;
    if (modeItem?.value === 'all' || modeItem?.value === 'any') {
      step.mode = modeItem.value;
    }

    // timeoutMs must resolve to a positive integer: only immediate
    // (numeric) and reference modes are representable.
    const timeoutItem = inputMapping.find(
      (item: any) => item.type === 'timeoutMs'
    );
    delete step.timeoutMs;
    if (timeoutItem?.value !== undefined && timeoutItem.value !== '') {
      if (timeoutItem.valueType === 'reference') {
        step.timeoutMs = {
          valueType: 'reference',
          value: timeoutItem.value,
        };
      } else if (timeoutItem.valueType !== 'template') {
        const timeoutNumber = Number(timeoutItem.value);
        if (Number.isFinite(timeoutNumber)) {
          step.timeoutMs = {
            valueType: 'immediate',
            value: timeoutNumber,
          };
        }
      }
    }
  }
}

/**
 * SetState: the mapping rows are the state fields it writes, saved as
 * `values` (deny_unknown_fields, no inputMapping). GetState has no
 * configuration. Neither takes a durable flag.
 */
function serializeSetState(ctx: StepSerializeContext): void {
  const { step } = ctx;
  step.values = step.inputMapping ?? {};
  delete step.inputMapping;
  delete step.durable;
}

function serializeGetState(ctx: StepSerializeContext): void {
  const { step } = ctx;
  delete step.inputMapping;
  delete step.values;
  delete step.durable;
}

/**
 * One entry per DSL step type, typed to have exactly those: a step type the
 * server adds does not compile until it says here how it is saved. `null` is
 * a step that is whole once the shared part is done.
 */
export const STEP_SERIALIZERS: { [T in StepType]: StepSerializer | null } = {
  Finish: null,
  Agent: null,
  // Their fields are written with the input mapping, in serializeSteps.
  Log: null,
  Error: null,
  Conditional: serializeConditional,
  Delay: serializeDelay,
  EmbedWorkflow: serializeEmbedWorkflow,
  Split: serializeSplit,
  Switch: serializeSwitch,
  Filter: serializeFilter,
  While: serializeWhile,
  GroupBy: serializeGroupBy,
  AiAgent: serializeAiAgent,
  WaitForSignal: serializeWaitForSignal,
  WaitForInstances: serializeWaitForInstances,
  SetState: serializeSetState,
  GetState: serializeGetState,
};

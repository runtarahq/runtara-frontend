import {
  processCompositeValue,
  processMappingEntry,
} from '@/features/workflows/utils/mapping-serialization';
import { buildSchemaFromFields } from '@/features/workflows/utils/schema';
import { convertConditionArguments } from '@/shared/utils/condition-type-conversion';
import {
  DURATION_FIELDS,
  readDuration,
  mapMatchTypeToAPI,
} from './field-values';

function normalizeConditionExpression(condition: any): any {
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
export function serializeSteps(steps: Record<string, any>) {
  const cleaned: Record<string, any> = {};

  if (!steps) {
    return {};
  }

  for (const [id, step] of Object.entries(steps)) {
    const { measured, position, subgraph, data } = step;
    // Destructure to exclude UI-only fields from the cleaned data
    const {
      inputMapping = [],
      inputSchema,
      outputSchema,
      childWorkflowId,
      childVersion,
      inputSchemaFields: _1,
      variablesFields: _2,
      splitInputSchemaFields: _3,
      splitOutputSchemaFields: _4,
      embedWorkflowConfig: _5,
      splitVariablesFields: _6,
      splitParallelism: _7,
      splitSequential: _8,
      splitDontStopOnFailed: _9,
      splitMaxRetries,
      splitRetryDelay,
      splitTimeout,
      splitAllowNull,
      splitConvertSingleValue,
      splitBatchSize,
      formTabs: _10,
      startMode: _11,
      selectedTriggerId: _12,
      executionTimeout: _13,
      retryStrategy: _14,
      groupByKey,
      groupByExpectedKeys,
      filterCondition,
      whileCondition,
      whileMaxIterations,
      whileTimeout,
      whileVariablesFields,
      subgraphMeta: _15,
      ...restData
    } = data;
    // Suppress unused variable warnings for destructured exclusions
    void _1;
    void _2;
    void _3;
    void _4;
    void _5;
    void _6;
    void _7;
    void _8;
    void _9;
    void _10;
    void _11;
    void _12;
    void _13;
    void _14;
    void _15;

    if (subgraph) {
      data.subgraph = {
        ...(subgraph || {}),
        steps: serializeSteps(subgraph.steps),
      };
    }

    // Handle inputMapping - convert array format to object format
    let cleanedInputMapping = inputMapping;
    // console.log("[DEBUG] cleanNodeData - inputMapping for node', id, ':', inputMapping);

    const hasMappingValuePayload = (mappingValue: any): boolean => {
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

    const serializeSourceMappingValue = (mapping: any[]): any | undefined => {
      if (!Array.isArray(mapping) || mapping.length === 0) return undefined;
      const sourceEntry =
        mapping.find((item: any) => item?.type === 'value') ?? mapping[0];
      if (!sourceEntry) return undefined;
      if (
        sourceEntry.value === undefined ||
        (typeof sourceEntry.value === 'string' &&
          sourceEntry.value.trim() === '')
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

    const parseObjectValue = (value: any): Record<string, any> | undefined => {
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

    const serializeMappingObject = (
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
        data.stepType === 'Finish';
      // Error/Log extract direct fields (code, message, level, ...) from the
      // filtered mapping, where '' is the form's "field cleared" signal and
      // must keep deleting the key. Every other consumer serializes a real
      // inputMapping object, where immediate '' is a legal DSL value.
      const emptyStringMeansCleared =
        data.stepType === 'Error' || data.stepType === 'Log';
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

      // Error steps need direct field values, not InputMapping wrapping
      if (data.stepType === 'Error') {
        // Extract error fields as direct values to match backend DSL
        const errorFields = ['code', 'message', 'category', 'severity'];
        errorFields.forEach((field) => {
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
            if (errorFields.includes(type)) {
              filteredRestData[type] = value; // Direct string value
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
        // Don't include inputMapping for Error steps
        cleanedInputMapping = undefined;
      } else if (data.stepType === 'Log') {
        // Log steps need direct field values (message, level) to match backend DSL
        const logFields = ['message', 'level'];
        logFields.forEach((field) => {
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
            if (logFields.includes(type)) {
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
        // Don't include inputMapping for Log steps
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

    if (restData.stepType === 'Agent' && data.capabilityId) {
      cleaned[id].capabilityId = data.capabilityId;
    }

    if (restData.stepType !== 'Agent') {
      delete cleaned[id].agentId;
      delete cleaned[id].capabilityId;
    }
    if (restData.stepType !== 'Agent' && restData.stepType !== 'AiAgent') {
      delete cleaned[id].connectionId;
    }
    if (
      restData.stepType !== 'Agent' &&
      restData.stepType !== 'EmbedWorkflow'
    ) {
      delete cleaned[id].maxRetries;
      const isWait =
        restData.stepType === 'WaitForSignal' ||
        (restData.stepType as string) === 'WaitForInstances';
      for (const [canonical, legacy] of DURATION_FIELDS) {
        // A Wait step's own `timeoutMs` is a mapping, not a step duration.
        if (!(isWait && canonical === 'timeoutMs')) {
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
    if (restData.stepType !== 'Split') {
      delete cleaned[id].inputSchema;
    }

    // Include processed subgraph for container steps (Split)
    // The subgraph is reconstructed by composeExecutionGraph from child nodes with parentId,
    // and processed via the recursive cleanNodeData call at lines 504-510.
    if (subgraph) {
      cleaned[id].subgraph = data.subgraph;
    }

    if (restData.stepType === 'Conditional' && (restData as any).condition) {
      delete cleaned[id].inputMapping;
      cleaned[id].condition = normalizeConditionExpression(
        (restData as any).condition
      );
    }

    if (restData.stepType === 'Delay') {
      const durationItem = Array.isArray(inputMapping)
        ? inputMapping.find((item: any) => item.type === 'durationMs')
        : undefined;
      delete cleaned[id].inputMapping;
      if (durationItem?.value !== undefined && durationItem.value !== '') {
        const [, durationValue] = processMappingEntry({
          type: 'durationMs',
          value: durationItem.value,
          typeHint: durationItem.typeHint || 'number',
          valueType: durationItem.valueType || 'immediate',
          defaultValue: durationItem.defaultValue,
        }) as [string, unknown];
        cleaned[id].durationMs = durationValue;
      }
    }

    // Ensure EmbedWorkflow has childWorkflowId and childVersion at root level (DSL v2.0.0 requirement)
    if (restData.stepType === 'EmbedWorkflow') {
      if (childWorkflowId) {
        cleaned[id].childWorkflowId = childWorkflowId;
      }
      if (childVersion !== undefined) {
        // Backend ChildVersion is an untagged enum: string ("latest"/"current") or integer.
        // Convert numeric strings to integers so serde deserializes to Specific(i32).
        const v = childVersion;
        const num = Number(v);
        cleaned[id].childVersion =
          typeof v === 'string' &&
          v !== '' &&
          !isNaN(num) &&
          v !== 'latest' &&
          v !== 'current'
            ? num
            : v;
      }
    }

    // Split step: use config instead of inputMapping, include schemas
    if (restData.stepType === 'Split') {
      // Remove inputMapping for Split steps - we use config instead
      delete cleaned[id].inputMapping;
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
          (splitConfig as any)[field] = readDuration(
            existingSplitConfig,
            field
          );
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
        cleaned[id].config = splitConfig;
      }

      // Add outputSchema if defined
      if (
        outputSchema &&
        typeof outputSchema === 'object' &&
        Object.keys(outputSchema).length > 0
      ) {
        cleaned[id].outputSchema = outputSchema;
      }
    }

    // Switch step: use config instead of inputMapping
    if (restData.stepType === 'Switch') {
      // Remove inputMapping for Switch steps - we use config instead
      delete cleaned[id].inputMapping;
      delete cleaned[id].switchRoutingMode;

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
        const casesItem = inputMapping.find(
          (item: any) => item.type === 'cases'
        );
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
        cleaned[id].config = switchConfig;
      }
    }

    // Filter step: use config instead of inputMapping
    if (restData.stepType === 'Filter') {
      delete cleaned[id].inputMapping;
      delete cleaned[id].filterCondition;
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
        cleaned[id].config = filterConfig;
      }
    }

    // While step: serialize condition and config
    if (restData.stepType === 'While') {
      delete cleaned[id].inputMapping;
      delete cleaned[id].whileCondition;
      delete cleaned[id].whileMaxIterations;
      delete cleaned[id].whileTimeout;

      // Set condition at root level (API expects WhileStep.condition)
      if (whileCondition) {
        cleaned[id].condition = normalizeConditionExpression(whileCondition);
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
      if (
        Array.isArray(whileVariablesFields) &&
        whileVariablesFields.length > 0
      ) {
        const mappedVariables: NonNullable<typeof whileConfig.variables> = {};
        for (const variableField of whileVariablesFields) {
          const variableName =
            typeof variableField.name === 'string'
              ? variableField.name.trim()
              : '';
          if (!variableName || variableField.value === undefined) continue;
          const resolvedValueType =
            variableField.valueType ||
            (typeof variableField.value === 'object' &&
            variableField.value !== null
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
        cleaned[id].config = whileConfig;
      }
    }

    // GroupBy step: use config instead of inputMapping
    if (restData.stepType === 'GroupBy') {
      delete cleaned[id].inputMapping;
      delete cleaned[id].groupByKey;
      delete cleaned[id].groupByExpectedKeys;
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
      if (
        Array.isArray(groupByExpectedKeys) &&
        groupByExpectedKeys.length > 0
      ) {
        groupByConfig.expectedKeys = groupByExpectedKeys;
      } else if (Array.isArray(existingGroupByConfig?.expectedKeys)) {
        groupByConfig.expectedKeys = existingGroupByConfig.expectedKeys;
      }

      // Only add config if it has the required fields
      if (groupByConfig.value && groupByConfig.key) {
        cleaned[id].config = groupByConfig;
      }
    }

    // AiAgent step: use config instead of inputMapping
    if (restData.stepType === 'AiAgent') {
      delete cleaned[id].inputMapping;

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
        if (
          userPromptItem?.value !== undefined &&
          userPromptItem.value !== ''
        ) {
          aiAgentConfig.userPrompt = {
            valueType: userPromptItem.valueType || 'immediate',
            value: userPromptItem.value,
          };
        }

        const modelItem = inputMapping.find(
          (item: any) => item.type === 'model'
        );
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
        if (
          temperatureItem?.value !== undefined &&
          temperatureItem.value !== ''
        ) {
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
        if (
          maxRetriesItem?.value !== undefined &&
          maxRetriesItem.value !== ''
        ) {
          aiAgentConfig.maxRetries = Number(maxRetriesItem.value);
        }

        const retryDelayItem = inputMapping.find(
          (item: any) => item.type === 'retryDelay'
        );
        if (
          retryDelayItem?.value !== undefined &&
          retryDelayItem.value !== ''
        ) {
          aiAgentConfig.retryDelayMs = Number(retryDelayItem.value);
        }

        const turnTimeoutItem = inputMapping.find(
          (item: any) => item.type === 'turnTimeout'
        );
        if (
          turnTimeoutItem?.value !== undefined &&
          turnTimeoutItem.value !== ''
        ) {
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
          (maxMessagesItem?.value !== undefined &&
            maxMessagesItem.value !== '') ||
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

      cleaned[id].config = aiAgentConfig;
    }

    // WaitForSignal step: fields are top-level (not nested under config).
    // Cleared form fields must DELETE the stale top-level key — loaded step
    // data is spread into node.data and would otherwise resurrect on save.
    // Semantics of absent keys: timeoutMs = wait indefinitely; pollIntervalMs =
    // runtime default (1000ms); responseSchema = no validation; action = none.
    if (restData.stepType === 'WaitForSignal') {
      delete cleaned[id].inputMapping;

      // Container-mode WaitForSignal: composeExecutionGraph rebuilds parented
      // children into `subgraph` (generic container path); the DSL field is
      // `onWait`. The rebuilt container is the single source of truth — it
      // overwrites any raw onWait leftover in restData. A container with no
      // children produces no subgraph, so the onWait key is removed entirely
      // (an empty onWait graph has no meaning and the empty-steps graph shape
      // is never validated/compiled).
      if (subgraph) {
        cleaned[id].onWait = data.subgraph;
        delete cleaned[id].subgraph;
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
          cleaned[id].responseSchema = buildSchemaFromFields(
            responseSchemaItem.value
          );
        } else {
          delete cleaned[id].responseSchema;
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
        delete cleaned[id].timeoutMs;
        if (timeoutItem?.value !== undefined && timeoutItem.value !== '') {
          if (timeoutItem.valueType === 'reference') {
            cleaned[id].timeoutMs = {
              valueType: 'reference',
              value: timeoutItem.value,
            };
          } else {
            const timeoutNumber = Number(timeoutItem.value);
            if (Number.isFinite(timeoutNumber)) {
              cleaned[id].timeoutMs = {
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
        delete cleaned[id].pollIntervalMs;
        if (pollItem?.value !== undefined && pollItem.value !== '') {
          const pollNumber = Number(pollItem.value);
          if (Number.isFinite(pollNumber)) {
            cleaned[id].pollIntervalMs = Math.round(pollNumber);
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
          cleaned[id].action = action;
        } else {
          delete cleaned[id].action;
        }

        // onWait: the form editor sets `onWait` to undefined when blanked;
        // drop null/undefined leftovers so the key never resurrects.
        if (cleaned[id].onWait == null) {
          delete cleaned[id].onWait;
        }
      }
    }

    // WaitForInstances step: instanceIds, mode and timeoutMs are top-level
    // fields (deny_unknown_fields, no inputMapping). Cleared form fields
    // delete their key so loaded step data cannot resurrect them on save.
    // An absent mode means `all`; an absent timeoutMs means no deadline.
    if (restData.stepType === 'WaitForInstances') {
      delete cleaned[id].inputMapping;
      delete cleaned[id].durable;

      if (Array.isArray(inputMapping)) {
        const idsItem = inputMapping.find(
          (item: any) => item.type === 'instanceIds'
        );
        delete cleaned[id].instanceIds;
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
            cleaned[id].instanceIds = idsValue;
          }
        }

        const modeItem = inputMapping.find((item: any) => item.type === 'mode');
        delete cleaned[id].mode;
        if (modeItem?.value === 'all' || modeItem?.value === 'any') {
          cleaned[id].mode = modeItem.value;
        }

        // timeoutMs must resolve to a positive integer: only immediate
        // (numeric) and reference modes are representable.
        const timeoutItem = inputMapping.find(
          (item: any) => item.type === 'timeoutMs'
        );
        delete cleaned[id].timeoutMs;
        if (timeoutItem?.value !== undefined && timeoutItem.value !== '') {
          if (timeoutItem.valueType === 'reference') {
            cleaned[id].timeoutMs = {
              valueType: 'reference',
              value: timeoutItem.value,
            };
          } else if (timeoutItem.valueType !== 'template') {
            const timeoutNumber = Number(timeoutItem.value);
            if (Number.isFinite(timeoutNumber)) {
              cleaned[id].timeoutMs = {
                valueType: 'immediate',
                value: timeoutNumber,
              };
            }
          }
        }
      }
    }

    // SetState: the mapping rows are the state fields it writes, saved as
    // `values` (deny_unknown_fields, no inputMapping). GetState has no
    // configuration. Neither takes a durable flag.
    if (restData.stepType === 'SetState') {
      cleaned[id].values = cleaned[id].inputMapping ?? {};
      delete cleaned[id].inputMapping;
      delete cleaned[id].durable;
    }
    if (restData.stepType === 'GetState') {
      delete cleaned[id].inputMapping;
      delete cleaned[id].values;
      delete cleaned[id].durable;
    }
  }

  return cleaned;
}

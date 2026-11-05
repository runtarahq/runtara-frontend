import type { ValueType } from '@/generated/RuntaraRuntimeApi';
import type { Node, Edge } from '@xyflow/react';
import type {
  ExecutionGraphDto,
  ExecutionGraphStepDto,
  ExecutionGraphTransitionDto,
} from '@/features/workflows/types/execution-graph';
import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
  STEP_TYPES,
} from '@/features/workflows/config/workflow';
import {
  snapToGrid,
  snapPositionToGrid,
} from '@/features/workflows/config/workflow-editor';
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  ensureContainersContainChildren,
} from '@/features/workflows/components/WorkflowEditor/CustomNodes/layout';
import { convertCompositeToUIFormat } from '@/features/workflows/utils/mapping-serialization';
import {
  parseSchema,
  type SchemaField,
} from '@/features/workflows/utils/schema';
import { canvasScopeKey, canvasOnWaitGraph } from './canvas-ids';
import {
  DURATION_FIELDS,
  readDuration,
  mapMatchTypeFromAPI,
} from './field-values';

function normalizeSchemaFieldForEditor(field: SchemaField): SchemaField {
  return {
    ...field,
    type: field.type || 'string',
    required: field.required !== false,
    description: field.description || '',
  };
}
export function normalizeNodesAndEdges(
  steps: Record<string, ExecutionGraphStepDto>,
  executionPlan: ExecutionGraphTransitionDto[],
  canvasNodeIds: Map<string, string>,
  parentId?: string
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIdOf = (stepId: string) =>
    canvasNodeIds.get(canvasScopeKey(parentId, stepId)) ?? stepId;

  // nodes
  for (const [id, step] of Object.entries(steps)) {
    const { subgraph, ...data } = step;
    // The form keeps the short duration names (see DURATION_FIELDS). Only
    // Agent and EmbedWorkflow carry them on the step; the Wait steps' own
    // `timeoutMs` is a mapping and stays as it is.
    if (step.stepType === 'Agent' || step.stepType === 'EmbedWorkflow') {
      for (const [canonical, legacy] of DURATION_FIELDS) {
        const record = data as Record<string, unknown>;
        if (record[canonical] !== undefined) {
          record[legacy] = record[canonical];
          delete record[canonical];
        }
      }
    }
    // A SetState step's `values` edit like an input mapping: one row per
    // state field it writes. The raw key leaves node.data so a save rebuilds
    // it from the rows.
    const setStateValues =
      (step.stepType as string) === 'SetState'
        ? ((data as Record<string, unknown>).values as
            Record<string, unknown> | undefined)
        : undefined;
    if (setStateValues !== undefined) {
      delete (data as Record<string, unknown>).values;
    }
    const { inputMapping = setStateValues ?? {} } = data;

    // WaitForSignal `onWait` is a nested ExecutionGraph (DSL field name
    // differs from `subgraph`, machinery is identical). A non-empty onWait
    // explodes into child nodes with parentId — exactly like a Split
    // subgraph — and its graph-level fields ride the subgraphMeta carrier.
    // The raw key is removed from node.data so the restData spread on save
    // can never resurrect it; the rebuilt container is the source of truth.
    // Empty/malformed onWait graphs stay in node.data (defensive JSON path).
    const onWaitGraph: ExecutionGraphDto | undefined = canvasOnWaitGraph(step);
    if (onWaitGraph) {
      delete (data as Record<string, unknown>).onWait;
    }

    // Preserve subgraph-level ExecutionGraph fields (variables, schemas,
    // name, description, notes, entryPoint, ...). Child steps/edges become
    // React Flow nodes and the subgraph is rebuilt from them on save, so
    // anything not carried here would be silently dropped by a save.
    const nestedGraph = subgraph ?? onWaitGraph;
    if (nestedGraph) {
      const {
        steps: _subgraphSteps,
        executionPlan: _subgraphPlan,
        ...subgraphMeta
      } = nestedGraph as Record<string, unknown>;
      void _subgraphSteps;
      void _subgraphPlan;
      if (Object.keys(subgraphMeta).length > 0) {
        (data as Record<string, unknown>).subgraphMeta = subgraphMeta;
      }
    }

    // WaitForSignal steps with an onWait graph render as containers so the
    // existing Split/While container machinery (canvas group node, child
    // scope) applies unchanged.
    const nodeType = onWaitGraph
      ? NODE_TYPES.ContainerNode
      : step.stepType
        ? STEP_TYPES[step.stepType] || NODE_TYPES.BasicNode
        : NODE_TYPES.BasicNode;

    // Helper function to safely parse potentially double-stringified values
    const safeParseValue = (value: any): any => {
      if (typeof value !== 'string') return value;
      try {
        const parsed = JSON.parse(value);
        // If it's still a string after parsing, it might be double-stringified
        if (typeof parsed === 'string') {
          return parsed;
        }
        return parsed;
      } catch {
        return value;
      }
    };

    // Get correct size for this node type
    const nodeSize = NODE_TYPE_SIZES[nodeType] || {
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
    };

    // Type assertion for extended properties that may exist at runtime
    const extendedData = data as any;
    const parsedInputSchema = safeParseValue((data as any).inputSchema);

    const nodeId = nodeIdOf(id);
    const node: Node = {
      id: nodeId,
      type: nodeType,
      data: {
        ...data,
        ...(parsedInputSchema ? { inputSchema: parsedInputSchema } : {}),
        // Fix potentially double-stringified values for EmbedWorkflow steps
        ...(extendedData.childWorkflowId && {
          childWorkflowId: safeParseValue(extendedData.childWorkflowId),
        }),
        ...(extendedData.childVersion && {
          childVersion: safeParseValue(extendedData.childVersion),
        }),
        // Handle inputMapping conversion - flat object format
        inputMapping: Object.keys(inputMapping).map((input) => {
          const mappingValue = inputMapping[input];

          // Handle new format: { valueType, value, type?, default? }
          if (
            typeof mappingValue === 'object' &&
            mappingValue !== null &&
            'value' in mappingValue
          ) {
            const typedValue = mappingValue as {
              value: any;
              type?: string;
              default?: any;
              valueType?: 'reference' | 'immediate' | 'composite' | 'template';
            };

            // For composite values, convert nested 'type' fields to 'typeHint'
            if (typedValue.valueType === 'composite') {
              return {
                type: input,
                value: convertCompositeToUIFormat(typedValue.value),
                typeHint: typedValue.type as ValueType | undefined,
                valueType: 'composite' as const,
              };
            }

            const resolvedValueType = typedValue.valueType || 'immediate';
            const entry: {
              type: string;
              value: any;
              typeHint: ValueType | undefined;
              valueType: 'reference' | 'immediate' | 'template';
              defaultValue?: any;
            } = {
              type: input,
              value: typedValue.value, // Can be string, array, object, or composite structure
              typeHint: typedValue.type as ValueType | undefined,
              valueType: resolvedValueType as
                'reference' | 'immediate' | 'template',
            };
            // Preserve ReferenceValue.default so a subsequent save doesn't drop it.
            if (
              resolvedValueType === 'reference' &&
              typedValue.default !== undefined
            ) {
              entry.defaultValue = typedValue.default;
            }
            return entry;
          }

          // Handle legacy format: string value
          return {
            type: input,
            value: mappingValue,
            typeHint: undefined,
            valueType: 'immediate' as const,
          };
        }),
        // For Split steps, parse config, inputSchema and outputSchema into UI fields
        ...(step.stepType === 'Split'
          ? (() => {
              const config = (data as any).config;
              // Convert config.value to inputMapping format for the UI.
              // Carry the backend `type` through so the save path can round-trip it.
              const splitInputMapping = config?.value
                ? [
                    {
                      type: 'value',
                      value: config.value.value,
                      typeHint: config.value.type ?? 'auto',
                      valueType: config.value.valueType || 'reference',
                      ...(config.value.default !== undefined
                        ? { defaultValue: config.value.default }
                        : {}),
                    },
                  ]
                : [];

              // Convert config.variables to splitVariablesFields format
              const splitVariablesFields = config?.variables
                ? Object.entries(config.variables).map(([name, varDef]) => {
                    const typedVarDef = varDef as {
                      valueType?:
                        'reference' | 'immediate' | 'composite' | 'template';
                      value: unknown;
                      type?: string;
                    };
                    const resolvedValueType:
                      'reference' | 'immediate' | 'composite' | 'template' =
                      typedVarDef.valueType ||
                      (typeof typedVarDef.value === 'object' &&
                      typedVarDef.value !== null
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
                      ...(typedVarDef.type !== undefined
                        ? { type: typedVarDef.type }
                        : {}),
                      valueType: resolvedValueType,
                    };
                  })
                : [];

              return {
                // Override inputMapping with config.value for Split steps
                inputMapping: splitInputMapping,
                splitInputSchemaFields: parsedInputSchema
                  ? parseSchema(parsedInputSchema).map(
                      normalizeSchemaFieldForEditor
                    )
                  : [],
                splitOutputSchemaFields: (data as any).outputSchema
                  ? parseSchema((data as any).outputSchema).map(
                      normalizeSchemaFieldForEditor
                    )
                  : [],
                outputSchema: safeParseValue((data as any).outputSchema),
                // Config fields
                splitVariablesFields,
                splitParallelism: config?.parallelism ?? 0,
                splitSequential: config?.sequential ?? false,
                splitDontStopOnFailed: config?.dontStopOnFailed ?? false,
                splitMaxRetries: config?.maxRetries ?? undefined,
                splitRetryDelay:
                  readDuration(config, 'retryDelayMs') ?? undefined,
                splitTimeout: readDuration(config, 'timeoutMs') ?? undefined,
                splitAllowNull: config?.allowNull ?? false,
                splitConvertSingleValue: config?.convertSingleValue ?? false,
                splitBatchSize: config?.batchSize ?? undefined,
              };
            })()
          : {}),
        // For Switch steps, parse config into inputMapping format for the UI
        ...((step.stepType as string) === 'Switch'
          ? (() => {
              const config = (data as any).config;
              const switchInputMapping: any[] = [];

              // Convert config.value to value field. Carry the backend `type`
              // and `default` through so the save path can round-trip them.
              if (config?.value) {
                switchInputMapping.push({
                  type: 'value',
                  value: config.value.value,
                  typeHint: config.value.type ?? 'auto',
                  valueType: config.value.valueType || 'reference',
                  ...(config.value.default !== undefined
                    ? { defaultValue: config.value.default }
                    : {}),
                });
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
              const hasRoutes = uiCases.some(
                (c: any) => c.route && c.route !== ''
              );

              return {
                inputMapping: switchInputMapping,
                ...(hasRoutes
                  ? {
                      switchRoutingMode: true,
                    }
                  : {}),
              };
            })()
          : {}),
        // For Filter steps, parse config into form fields
        ...((step.stepType as string) === 'Filter'
          ? (() => {
              const config = (data as any).config;
              const filterInputMapping = config?.value
                ? [
                    {
                      type: 'value',
                      value: config.value.value,
                      typeHint: config.value.type ?? 'auto',
                      valueType: config.value.valueType || 'reference',
                      ...(config.value.default !== undefined
                        ? { defaultValue: config.value.default }
                        : {}),
                    },
                  ]
                : [];

              return {
                inputMapping: filterInputMapping,
                filterCondition: config?.condition,
              };
            })()
          : {}),
        // For While steps, parse condition and config into form fields
        ...((step.stepType as string) === 'While'
          ? (() => {
              const config = (data as any).config;
              const whileVariablesFields = config?.variables
                ? Object.entries(config.variables).map(([name, variable]) => {
                    const typedVariable = variable as {
                      valueType?:
                        'reference' | 'immediate' | 'composite' | 'template';
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
                whileCondition: (data as any).condition,
                whileMaxIterations: config?.maxIterations ?? 10,
                whileTimeout: readDuration(config, 'timeoutMs') ?? null,
                whileVariablesFields,
              };
            })()
          : {}),
        // For GroupBy steps, parse config into form fields
        ...((step.stepType as string) === 'GroupBy'
          ? (() => {
              const config = (data as any).config;
              const groupByInputMapping = config?.value
                ? [
                    {
                      type: 'value',
                      value: config.value.value,
                      typeHint: config.value.type ?? 'auto',
                      valueType: config.value.valueType || 'reference',
                      ...(config.value.default !== undefined
                        ? { defaultValue: config.value.default }
                        : {}),
                    },
                  ]
                : [];

              return {
                inputMapping: groupByInputMapping,
                groupByKey: config?.key || '',
                groupByExpectedKeys: Array.isArray(config?.expectedKeys)
                  ? config.expectedKeys
                  : [],
              };
            })()
          : {}),
        // For AiAgent steps, parse config into form fields
        ...((step.stepType as string) === 'AiAgent'
          ? (() => {
              const config = (data as any).config;
              const aiInputMapping: any[] = [];

              if (config?.systemPrompt) {
                aiInputMapping.push({
                  type: 'systemPrompt',
                  value: config.systemPrompt.value ?? '',
                  valueType: config.systemPrompt.valueType || 'immediate',
                  typeHint: 'string',
                });
              }

              if (config?.userPrompt) {
                aiInputMapping.push({
                  type: 'userPrompt',
                  value: config.userPrompt.value ?? '',
                  valueType: config.userPrompt.valueType || 'immediate',
                  typeHint: 'string',
                });
              }

              if (config?.model) {
                aiInputMapping.push({
                  type: 'model',
                  value: config.model.value ?? '',
                  valueType: config.model.valueType || 'immediate',
                  typeHint: config.model.type || 'string',
                  ...(config.model.valueType === 'reference' &&
                  config.model.default !== undefined
                    ? { defaultValue: config.model.default }
                    : {}),
                });
              }

              if (
                config?.maxIterations !== undefined &&
                config.maxIterations !== null
              ) {
                aiInputMapping.push({
                  type: 'maxIterations',
                  value: config.maxIterations,
                  valueType: 'immediate',
                  typeHint: 'integer',
                });
              }

              if (
                config?.temperature !== undefined &&
                config.temperature !== null
              ) {
                aiInputMapping.push({
                  type: 'temperature',
                  value: config.temperature.value ?? '',
                  valueType: config.temperature.valueType || 'immediate',
                  typeHint: config.temperature.type || 'number',
                  ...(config.temperature.valueType === 'reference' &&
                  config.temperature.default !== undefined
                    ? { defaultValue: config.temperature.default }
                    : {}),
                });
              }

              if (
                config?.maxTokens !== undefined &&
                config.maxTokens !== null
              ) {
                aiInputMapping.push({
                  type: 'maxTokens',
                  value: config.maxTokens.value ?? '',
                  valueType: config.maxTokens.valueType || 'immediate',
                  typeHint: config.maxTokens.type || 'integer',
                  ...(config.maxTokens.valueType === 'reference' &&
                  config.maxTokens.default !== undefined
                    ? { defaultValue: config.maxTokens.default }
                    : {}),
                });
              }

              if (
                config?.maxRetries !== undefined &&
                config.maxRetries !== null
              ) {
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

                if (config.memory.conversationId) {
                  aiInputMapping.push({
                    type: 'memoryConversationId',
                    value: config.memory.conversationId.value ?? '',
                    valueType:
                      config.memory.conversationId.valueType || 'reference',
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
              if (
                config?.outputSchema &&
                typeof config.outputSchema === 'object'
              ) {
                const schemaFields = parseSchema(config.outputSchema);
                aiInputMapping.push({
                  type: 'outputSchema',
                  value: schemaFields.map(normalizeSchemaFieldForEditor),
                  valueType: 'immediate',
                  typeHint: 'json',
                });
              }

              return { inputMapping: aiInputMapping };
            })()
          : {}),
        // For Delay steps, parse durationMs into inputMapping format
        ...((step.stepType as string) === 'Delay'
          ? (() => {
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
            })()
          : {}),
        // For WaitForSignal steps, parse top-level fields into inputMapping
        ...((step.stepType as string) === 'WaitForSignal'
          ? (() => {
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
                  waitStep.pollIntervalMs !== undefined &&
                  waitStep.pollIntervalMs !== null
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
                  value: convertCompositeToUIFormat(
                    waitStep.action.correlation
                  ),
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
            })()
          : {}),
        // For WaitForInstances steps, parse top-level fields into inputMapping
        ...((step.stepType as string) === 'WaitForInstances'
          ? (() => {
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
            })()
          : {}),
        // For Log steps, parse top-level fields into inputMapping
        ...((step.stepType as string) === 'Log'
          ? (() => {
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
            })()
          : {}),
        // For Error steps, parse top-level fields into inputMapping
        ...((step.stepType as string) === 'Error'
          ? (() => {
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
            })()
          : {}),
      },
      // Resizable nodes (Container, Note) use saved dimensions; others always use config size
      width: snapToGrid(
        nodeType === NODE_TYPES.ContainerNode ||
          nodeType === NODE_TYPES.NoteNode
          ? (data.renderingParameters?.width ?? nodeSize.width)
          : nodeSize.width
      ),
      height: snapToGrid(
        nodeType === NODE_TYPES.ContainerNode ||
          nodeType === NODE_TYPES.NoteNode
          ? (data.renderingParameters?.height ?? nodeSize.height)
          : nodeSize.height
      ),
      style: {
        width: snapToGrid(
          nodeType === NODE_TYPES.ContainerNode ||
            nodeType === NODE_TYPES.NoteNode
            ? (data.renderingParameters?.width ?? nodeSize.width)
            : nodeSize.width
        ),
        height: snapToGrid(
          nodeType === NODE_TYPES.ContainerNode ||
            nodeType === NODE_TYPES.NoteNode
            ? (data.renderingParameters?.height ?? nodeSize.height)
            : nodeSize.height
        ),
      },
      position: snapPositionToGrid({
        x: data.renderingParameters?.x ?? 0,
        y: data.renderingParameters?.y ?? 0,
      }),
    };

    if (parentId) {
      node.parentId = parentId;
      node.extent = 'parent';
      node.expandParent = true;
    }

    nodes.push(node);

    if (subgraph) {
      const { nodes: childNodes, edges: childEdges } = normalizeNodesAndEdges(
        subgraph.steps || {},
        subgraph.executionPlan || [],
        canvasNodeIds,
        nodeId
      );
      nodes.push(...childNodes);
      edges.push(...childEdges);
    } else if (onWaitGraph) {
      const { nodes: childNodes, edges: childEdges } = normalizeNodesAndEdges(
        onWaitGraph.steps || {},
        onWaitGraph.executionPlan || [],
        canvasNodeIds,
        nodeId
      );
      nodes.push(...childNodes);
      edges.push(...childEdges);
    }
  }

  // edges
  for (let i = 0; i < executionPlan.length; i++) {
    const edge = executionPlan[i];
    const sourceStep = steps[edge.fromStep ?? ''];
    const isSwitchSource = (sourceStep?.stepType as string) === 'Switch';

    let sourceHandle: string;

    if (isSwitchSource) {
      // Switch nodes: map edge labels to the correct sourceHandle
      const label = edge.label || 'next';
      if (label === 'default') {
        sourceHandle = 'default';
      } else if (label === 'next') {
        // Value mode: single output
        sourceHandle = 'source';
      } else if (label.startsWith('case-')) {
        // Direct case index label
        sourceHandle = label;
      } else {
        // Route label: find matching case index by route name
        const config = (sourceStep as any).config;
        const cases = config?.cases || [];
        const caseIndex = cases.findIndex((c: any) => c.route === label);
        sourceHandle = caseIndex >= 0 ? `case-${caseIndex}` : label;
      }
    } else {
      // Non-Switch: convert spec labels back to React Flow sourceHandle
      // "next" -> "source" for sequential edges, keep "true"/"false" for Conditional
      sourceHandle =
        !edge.label || edge.label === 'default' || edge.label === 'next'
          ? 'source'
          : edge.label;
    }

    const source = nodeIdOf(edge.fromStep ?? '');
    const target = nodeIdOf(edge.toStep ?? '');
    edges.push({
      id: `${source}-${target}-${edge.label || 'default'}-${i}`,
      source,
      target,
      sourceHandle,
      data: {
        ...(edge.condition !== undefined ? { condition: edge.condition } : {}),
        ...(edge.priority !== undefined ? { priority: edge.priority } : {}),
      },
    });
  }

  return { nodes: ensureContainersContainChildren(nodes), edges };
}

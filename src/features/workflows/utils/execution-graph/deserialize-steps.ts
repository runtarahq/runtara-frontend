import type { ValueType } from '@/generated/RuntaraRuntimeApi';
import type { Node, Edge } from '@xyflow/react';
import {
  type ExecutionGraphDto,
  type ExecutionGraphStepDto,
  type ExecutionGraphTransitionDto,
  stepSubgraph,
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
import { canvasScopeKey, canvasOnWaitGraph } from './canvas-ids';
import { safeParseValue, stepDeserializer } from './step-deserializers';
import { DURATION_FIELDS } from './field-values';

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
    const subgraph = stepSubgraph(step);
    const { subgraph: _nested, ...data } = step as ExecutionGraphStepDto & {
      subgraph?: unknown;
    };
    void _nested;
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
      step.stepType === 'SetState'
        ? ((data as Record<string, unknown>).values as
            Record<string, unknown> | undefined)
        : undefined;
    if (setStateValues !== undefined) {
      delete (data as Record<string, unknown>).values;
    }
    // Absent only: a mapping the step carries, even an empty one, is kept.
    const ownInputMapping = (data as { inputMapping?: Record<string, unknown> })
      .inputMapping;
    const inputMapping: Record<string, unknown> =
      ownInputMapping === undefined ? (setStateValues ?? {}) : ownInputMapping;

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
        // What this step type's form edits under its own names
        // (./step-deserializers.ts).
        ...(stepDeserializer(step.stepType)?.({
          id,
          data,
          parsedInputSchema,
          executionPlan,
        }) ?? {}),
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
    const isSwitchSource = sourceStep?.stepType === 'Switch';

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

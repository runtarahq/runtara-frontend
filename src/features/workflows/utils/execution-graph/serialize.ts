import type { Node, Edge } from '@xyflow/react';
import {
  NODE_TYPES,
  NODE_TYPE_SIZES,
} from '@/features/workflows/config/workflow';
import type {
  ExecutionGraphDto,
  ExecutionGraphStepDto,
  ExecutionGraphTransitionDto,
} from '@/features/workflows/types/execution-graph';
import type { ExecutionGraph } from './types';
import { canvasNodeStepId } from './canvas-ids';
import { serializeSteps } from './serialize-steps';

/*
  Payload schema

  |executionPlan                            |executionPlan
  |steps   -->   steps[id].subgraph   -->   |steps -->   ...
  |entryPoint                               |entryPoint
*/
export function composeExecutionGraph(
  nodes: Node[],
  edges: Edge[],
  options?: {
    name?: string;
    description?: string;
    variables?: Record<
      string,
      { type: string; value: unknown; description?: string | null }
    >;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    stateSchema?: Record<string, unknown>;
    executionTimeoutSeconds?: number;
    rateLimitBudgetMs?: number;
    durable?: boolean | null;
    entryPoint?: string;
  }
): ExecutionGraph | null {
  const nodesMap: any = new Map();
  const executionGraph: any = {};

  // Include name and description in the execution graph
  // Name is required for updates, so always include it if provided
  if (options?.name !== undefined) {
    executionGraph.name = options.name;
  }
  if (options?.description !== undefined) {
    executionGraph.description = options.description;
  }

  // Include variables and schemas in the execution graph if provided
  if (options?.variables) {
    executionGraph.variables = options.variables;
  }
  if (options?.inputSchema) {
    executionGraph.inputSchema = options.inputSchema;
  }
  if (options?.outputSchema) {
    executionGraph.outputSchema = options.outputSchema;
  }
  if (options?.stateSchema && Object.keys(options.stateSchema).length > 0) {
    executionGraph.stateSchema = options.stateSchema;
  }
  if (options?.executionTimeoutSeconds !== undefined) {
    executionGraph.executionTimeoutSeconds = options.executionTimeoutSeconds;
  }
  if (options?.rateLimitBudgetMs !== undefined) {
    executionGraph.rateLimitBudgetMs = options.rateLimitBudgetMs;
  }
  if (options?.durable !== undefined) {
    executionGraph.durable = options.durable;
  }
  if (options?.entryPoint) {
    executionGraph.entryPoint = options.entryPoint;
  }

  // Separate notes from regular nodes
  const noteNodes = nodes.filter((node) => node.type === NODE_TYPES.NoteNode);
  const nds = nodes.filter(
    (node) =>
      node.type !== NODE_TYPES.CreateNode && node.type !== NODE_TYPES.NoteNode
  );
  const stepNodeIds = new Set(nds.map((node) => node.id));

  if (nds.length > 0) {
    executionGraph.nodes = nds.map((node) => {
      const width =
        typeof node.style?.width === 'number'
          ? node.style.width
          : typeof node.width === 'number'
            ? node.width
            : undefined;
      const height =
        typeof node.style?.height === 'number'
          ? node.style.height
          : typeof node.height === 'number'
            ? node.height
            : undefined;

      return {
        id: node.id,
        type: node.type,
        position: node.position,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(node.parentId ? { parentId: node.parentId } : {}),
      };
    });
  }

  const visualEdges = edges
    .filter(
      (edge) => stepNodeIds.has(edge.source) && stepNodeIds.has(edge.target)
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    }));

  if (visualEdges.length > 0) {
    executionGraph.edges = visualEdges;
  }

  if (!nds.length && !noteNodes.length) {
    return null;
  }

  // Process notes into the execution graph
  // New format uses: { text, position: {x, y} }
  if (noteNodes.length > 0) {
    executionGraph.notes = noteNodes.map((node) => ({
      id: node.data.id || node.id,
      text: node.data.content || '',
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      metadata: {
        width: node.width || NODE_TYPE_SIZES[NODE_TYPES.NoteNode]?.width || 240,
        height:
          node.height || NODE_TYPE_SIZES[NODE_TYPES.NoteNode]?.height || 120,
        // Anchored notes store `position` as an offset from this step.
        ...(typeof node.data.anchorStepId === 'string' && node.data.anchorStepId
          ? { anchorStepId: node.data.anchorStepId }
          : {}),
      },
    }));
  }

  if (!nds.length) {
    return executionGraph;
  }

  // Create deep copies of nodes to avoid mutating the originals
  nds.forEach((node) => {
    const copy = JSON.parse(JSON.stringify(node));
    // A qualified canvas node saves under its real step id.
    if (copy.data && canvasNodeStepId(node.id) !== node.id) {
      copy.data.id = canvasNodeStepId(node.id);
    }
    nodesMap.set(node.id, copy);
  });

  nds.forEach((node) => {
    const stepType = node.data?.stepType;
    if (stepType === 'Split' || stepType === 'While') {
      const containerStep = nodesMap.get(node.id);
      if (containerStep && !containerStep.subgraph) {
        // Seed the rebuilt subgraph with the graph-level fields captured at
        // load time (variables, schemas, name, description, notes, ...).
        containerStep.subgraph = {
          ...(containerStep.data?.subgraphMeta || {}),
          steps: {},
        };
      }
    }
  });

  nds.forEach((node) => {
    if (node.parentId) {
      const parent = nodesMap.get(node.parentId);
      if (parent) {
        if (!parent.subgraph) {
          parent.subgraph = {
            ...(parent.data?.subgraphMeta || {}),
          };
          parent.subgraph.steps = {};
        }
        parent.subgraph.steps[canvasNodeStepId(node.id)] = nodesMap.get(
          node.id
        );
      }
    } else {
      if (!executionGraph.steps) {
        executionGraph.steps = {};
      }
      executionGraph.steps[canvasNodeStepId(node.id)] = nodesMap.get(node.id);
    }
  });

  edges.forEach((edge) => {
    const sourceNode = nodesMap.get(edge.source);
    const targetNode = nodesMap.get(edge.target);

    const groupId = sourceNode?.parentId || targetNode?.parentId;

    // Map edge sourceHandle to spec label
    // Per DSL v2.0.0: use "next" for sequential, "true"/"false" for Conditional
    const rawLabel = edge.sourceHandle || '';
    let specLabel =
      rawLabel === '' || rawLabel === 'source' ? 'next' : rawLabel;

    // For Switch routing mode, convert case-N handles to route labels
    if (rawLabel.startsWith('case-') && sourceNode) {
      const caseIndex = parseInt(rawLabel.split('-')[1], 10);
      const casesField = (sourceNode.data?.inputMapping || []).find(
        (item: any) => item.type === 'cases'
      );
      const cases = Array.isArray(casesField?.value) ? casesField.value : [];
      if (cases[caseIndex]?.route) {
        specLabel = cases[caseIndex].route;
      }
    }

    if (groupId && sourceNode?.parentId === targetNode?.parentId) {
      const parent = nodesMap.get(groupId);
      if (parent.subgraph) {
        if (!parent.subgraph.executionPlan) {
          parent.subgraph.executionPlan = [];
        }
        const planEdge: Record<string, unknown> = {
          fromStep: canvasNodeStepId(edge.source),
          toStep: canvasNodeStepId(edge.target),
          label: specLabel,
        };
        if ((edge.data as any)?.condition !== undefined) {
          planEdge.condition = (edge.data as any).condition;
        }
        if ((edge.data as any)?.priority !== undefined) {
          planEdge.priority = Number((edge.data as any).priority);
        }
        parent.subgraph.executionPlan.push(planEdge);
      }
    } else {
      if (!executionGraph.executionPlan) {
        executionGraph.executionPlan = [];
      }
      const planEdge: Record<string, unknown> = {
        fromStep: canvasNodeStepId(edge.source),
        toStep: canvasNodeStepId(edge.target),
        label: specLabel,
      };
      if ((edge.data as any)?.condition !== undefined) {
        planEdge.condition = (edge.data as any).condition;
      }
      if ((edge.data as any)?.priority !== undefined) {
        planEdge.priority = Number((edge.data as any).priority);
      }
      executionGraph.executionPlan.push(planEdge);
    }
  });

  executionGraph.steps = serializeSteps(executionGraph.steps);

  addStarts(executionGraph);
  stripEditorOnlyStepFields(executionGraph.steps);

  return executionGraph;
}

function stripEditorOnlyStepFields(steps?: Record<string, any>) {
  if (!steps) {
    return;
  }

  for (const step of Object.values(steps)) {
    delete step.renderingParameters;
    if (step.subgraph?.steps) {
      stripEditorOnlyStepFields(step.subgraph.steps);
    }
    // WaitForSignal nested onWait graph (container-mode steps).
    if (step.onWait?.steps) {
      stripEditorOnlyStepFields(step.onWait.steps);
    }
  }
}
function addStarts(executionGraph: ExecutionGraphDto) {
  function findStart(
    steps: Record<string, ExecutionGraphStepDto>,
    executionPlan: ExecutionGraphTransitionDto[]
  ) {
    const allIds = new Set(Object.keys(steps));
    const targets = new Set<string>();

    for (const { toStep = '' } of executionPlan) {
      if (allIds.has(toStep)) {
        targets.add(toStep);
      }
    }

    // Find all candidate entry points (nodes without incoming edges)
    const candidates: string[] = [];
    for (const id of allIds) {
      if (!targets.has(id)) {
        candidates.push(id);
      }
    }

    if (candidates.length === 0) {
      return '';
    }

    // If multiple candidates, pick the leftmost one (smallest x position)
    // This ensures the entry point stays stable when edges are deleted
    if (candidates.length === 1) {
      return candidates[0];
    }

    return candidates.reduce((leftmostId, id) => {
      const leftmostX = steps[leftmostId]?.renderingParameters?.x ?? Infinity;
      const currentX = steps[id]?.renderingParameters?.x ?? Infinity;
      return currentX < leftmostX ? id : leftmostId;
    });
  }

  function findAllStarts(executionGraph: ExecutionGraphDto) {
    const { steps = {}, executionPlan = [] } = executionGraph;
    if (!executionGraph.entryPoint || !steps[executionGraph.entryPoint]) {
      const entry = findStart(steps, executionPlan);
      executionGraph.entryPoint = entry;
    }

    for (const step of Object.values(steps)) {
      if (step.subgraph) {
        findAllStarts(step.subgraph);
      }
      // WaitForSignal onWait is a nested ExecutionGraph too — keep its
      // entryPoint valid as children are added/removed/rewired.
      const onWait = (step as { onWait?: ExecutionGraphDto }).onWait;
      if (onWait?.steps) {
        findAllStarts(onWait);
      }
    }
  }

  findAllStarts(executionGraph);
}

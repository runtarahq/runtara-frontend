import type { Node } from '@xyflow/react';
import {
  NODE_TYPE_SIZES,
  NODE_TYPES,
  STEP_TYPES,
} from '@/features/workflows/config/workflow';
import { snapPositionToGrid } from '@/features/workflows/config/workflow-editor';
import type { WorkflowState } from '@/features/workflows/stores/workflow-state';
import type { StepNodeData } from '@/features/workflows/types/execution-graph';
import { generateStepId } from '@/features/workflows/utils/step-ids';
import { getNodePositionInsideParent } from './CustomNodes/utils';

/** Where on the canvas a new step was asked for, and what it attaches to. */
export interface CreateStepContext {
  position: { x: number; y: number };
  parentId?: string;
  insertionEdge?: {
    source: string;
    target: string;
    sourceHandle: string;
  };
  connection?: {
    source: string;
    sourceHandle: string;
  };
  /**
   * Parallel fan-out over an existing source->target edge: the new step N is
   * wired source->N and N->target while the original edge is kept, so the
   * unconditional branches re-converge at the target (validator E073).
   */
  parallelBranch?: {
    source: string;
    target: string;
    sourceHandle: string;
  };
}

/** What the step picker hands back. */
export interface PickedStep {
  stepType: string;
  agentId?: string;
  capabilityId?: string;
  name: string;
}

/** A step chosen and placed, not yet in the workflow. */
export type PendingStep = NonNullable<WorkflowState['pendingNewNode']>;

/** The source of the edge that leaves the Start indicator. */
const START_INDICATOR = '__start_indicator__';

/**
 * A step name no node has yet: the name itself, or with the next free number
 * ("Random Double" → "Random Double 2" → "Random Double 3").
 */
export function generateUniqueStepName(
  baseName: string,
  existingNodes: Node[]
): string {
  const existingNames = new Set(
    existingNodes
      .filter((node) => node.data?.name)
      .map((node) => node.data.name as string)
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let counter = 2;
  while (existingNames.has(`${baseName} ${counter}`)) {
    counter++;
  }

  return `${baseName} ${counter}`;
}

/** A node's position on the canvas, through every container it is in. */
function absolutePosition(node: Node, nodes: Node[]): { x: number; y: number } {
  if (!node.parentId) return node.position;
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return node.position;
  const parentAbsolute = absolutePosition(parent, nodes);
  return {
    x: parentAbsolute.x + node.position.x,
    y: parentAbsolute.y + node.position.y,
  };
}

const nodeTypeOf = (stepType: unknown) =>
  STEP_TYPES[stepType as string] || NODE_TYPES.BasicNode;

export interface PlanPendingStep {
  picked: PickedStep;
  context: CreateStepContext;
  nodes: Node[];
  /** What a new step's form starts from. */
  initialData: Record<string, unknown>;
  /**
   * The nodes a would-be node overlaps, innermost last (React Flow's
   * `getIntersectingNodes`): which container a step dropped on empty canvas
   * lands in.
   */
  intersecting: (node: Node) => Node[];
}

/**
 * The step a pick from the step picker comes to: its id, its name, where it
 * goes and what it will be wired to once the user confirms it. Nothing is
 * added to the workflow here; the editor holds the result as the pending
 * node until its form is saved or cancelled.
 *
 * Where it goes depends on how it was asked for:
 * - as a parallel branch over an edge: at the asked position, in the
 *   container of the edge's source;
 * - on the edge from Start: left of the first step, level with it, and it
 *   becomes the entry point;
 * - on any other edge: at the asked position, replacing that edge;
 * - from a dragged connection: level with the handle it was dragged from,
 *   in the source's container;
 * - on empty canvas: where it was dropped, inside the container under it.
 */
export function planPendingStep({
  picked,
  context,
  nodes,
  initialData,
  intersecting,
}: PlanPendingStep): PendingStep {
  const name = generateUniqueStepName(picked.name, nodes);
  const id = generateStepId(
    name,
    nodes.map((node) => node.id)
  );
  const data = {
    ...initialData,
    stepType: picked.stepType,
    name,
    agentId: picked.agentId || '',
    capabilityId: picked.capabilityId || '',
  } as StepNodeData;

  if (context.parallelBranch) {
    const sourceNode = nodes.find(
      (n) => n.id === context.parallelBranch!.source
    );
    let position = context.position;
    let parentId: string | undefined;
    if (sourceNode?.parentId) {
      parentId = sourceNode.parentId;
      const parentNode = nodes.find((n) => n.id === parentId);
      if (parentNode) {
        const parentAbsolute = absolutePosition(parentNode, nodes);
        position = {
          x: context.position.x - parentAbsolute.x,
          y: context.position.y - parentAbsolute.y,
        };
      }
    }
    return {
      id,
      data,
      position,
      parentId,
      sourceNodeId: context.parallelBranch.source,
      sourceHandle: context.parallelBranch.sourceHandle,
      targetNodeId: context.parallelBranch.target,
    };
  }

  if (context.insertionEdge) {
    if (context.insertionEdge.source === START_INDICATOR) {
      const targetNode = nodes.find(
        (n) => n.id === context.insertionEdge!.target
      );
      if (targetNode) {
        const size = NODE_TYPE_SIZES[nodeTypeOf(data.stepType)] || {
          width: 180,
          height: 48,
        };
        const horizontalSpacing = 108;
        return {
          id,
          data,
          position: snapPositionToGrid({
            x: targetNode.position.x - size.width - horizontalSpacing,
            y:
              targetNode.position.y +
              (targetNode.height || 48) / 2 -
              size.height / 2,
          }),
          targetNodeId: context.insertionEdge.target,
          becomesEntryPoint: true,
        };
      }
    }
    return {
      id,
      data,
      position: context.position,
      insertionEdge: context.insertionEdge,
    };
  }

  if (context.connection) {
    const sourceNode = nodes.find((n) => n.id === context.connection!.source);
    const size = NODE_TYPE_SIZES[nodeTypeOf(data.stepType)];
    let position = context.position;
    let parentId: string | undefined;
    if (sourceNode) {
      const sourceAbsolute = absolutePosition(sourceNode, nodes);
      const sourceHandleY = sourceAbsolute.y + (sourceNode.height || 48) / 2;
      const levelWithHandle = {
        x: context.position.x,
        y: sourceHandleY - size.height / 2,
      };
      if (sourceNode.parentId) {
        parentId = sourceNode.parentId;
        const parentNode = nodes.find((n) => n.id === parentId);
        if (parentNode) {
          const parentAbsolute = absolutePosition(parentNode, nodes);
          position = {
            x: levelWithHandle.x - parentAbsolute.x,
            y: levelWithHandle.y - parentAbsolute.y,
          };
        }
      } else {
        position = levelWithHandle;
      }
    }
    return {
      id,
      data,
      position,
      parentId,
      sourceNodeId: context.connection.source,
      sourceHandle: context.connection.sourceHandle,
    };
  }

  const type = nodeTypeOf(data.stepType);
  const style = NODE_TYPE_SIZES[type];
  let parentId = context.parentId;
  let position = context.position;
  const wouldBe: Node = {
    id: 'temp',
    type,
    position: context.position,
    data: {},
    style,
    width: style.width,
    height: style.height,
  };
  const containers = intersecting(wouldBe).filter(
    (n) => n.type === NODE_TYPES.ContainerNode
  );
  const container = containers[containers.length - 1];
  if (!parentId && container) {
    position = getNodePositionInsideParent(wouldBe, container) ?? {
      x: 0,
      y: 0,
    };
    parentId = container.id;
  }
  return { id, data, position, parentId };
}

/** An edge to add: from a node, to a node, out of the handle `label` names. */
export interface PendingStepEdge {
  from: string;
  to: string;
  label: string;
}

/**
 * The edges a confirmed step is wired with, once it is on the canvas as
 * `nodeId`. A step that replaces an edge has none here: inserting it rewires
 * that edge.
 *
 * - A parallel branch (a source and a target): the leg from the source and
 *   the leg to the target; the edge it branches over is kept, so the fan-out
 *   re-converges (validator E073).
 * - Before a target only (the edge from Start): the leg to the target.
 * - From a source only (a dragged connection): the leg from the source.
 *
 * A Conditional leads both its branches on to a target.
 */
export function pendingStepEdges(
  pending: PendingStep,
  nodeId: string,
  isConditional: boolean
): PendingStepEdge[] {
  if (pending.insertionEdge) return [];
  const fromSource: PendingStepEdge[] = pending.sourceNodeId
    ? [
        {
          from: pending.sourceNodeId,
          to: nodeId,
          label: pending.sourceHandle || 'source',
        },
      ]
    : [];
  const toTarget: PendingStepEdge[] = pending.targetNodeId
    ? (isConditional ? ['true', 'false'] : ['source']).map((label) => ({
        from: nodeId,
        to: pending.targetNodeId!,
        label,
      }))
    : [];
  return [...fromSource, ...toTarget];
}

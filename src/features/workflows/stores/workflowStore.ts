import {
  generateStepId,
  getStepIdValidationError,
  rewriteStepReferencesDeep,
} from '@/features/workflows/utils/step-ids';
export {
  STEP_ID_PATTERN,
  generateStepId,
  getStepIdValidationError,
  rewriteStepReferencesDeep,
  rewriteStepReferencesInString,
} from '@/features/workflows/utils/step-ids';

import type { WorkflowState } from './workflow-state';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { applyEdgeChanges, applyNodeChanges, Edge, Node } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '@/shared/hooks/api';
import {
  canvasNodeStepId,
  composeExecutionGraph,
  executionGraphToReactFlow,
  getLayoutedElements,
} from '@/features/workflows/components/WorkflowEditor/CustomNodes/utils.tsx';
import {
  snapToGrid,
  snapPositionToGrid,
} from '@/features/workflows/config/workflow-editor';
import {
  NODE_TYPE_SIZES,
  NODE_TYPES,
  STEP_TYPES,
} from '@/features/workflows/config/workflow.ts';
import { validateConnection } from '@/features/workflows/utils/graph-validation';
import {
  expandParentToFitChildren,
  insertStepBetween,
} from './canvas-geometry';
import { createGraphNodeResolver } from '@/features/workflows/utils/step-node-resolver';

/** Marks the workflow edited. Every edit goes through here or `dirtied`. */
function markDirty(state: { isDirty: boolean; dirtyRevision: number }) {
  state.isDirty = true;
  state.dirtyRevision += 1;
}

/** The dirty fields for a plain `setState` that edits the workflow. */
export function dirtied(state: { dirtyRevision: number }) {
  return { isDirty: true, dirtyRevision: state.dirtyRevision + 1 } as const;
}

// State holds Sets (stagedNodeIds, stepsWithErrors); renameStep reads them
// inside an immer draft, which requires the MapSet plugin.
enableMapSet();

const initialState = {
  executionGraph: null,
  nodes: [],
  edges: [],
  isDirty: false,
  isStructurallyDirty: false,
  dirtyRevision: 0,
  selectedNodes: [],
  selectedEdges: [],
  stagedNodeIds: new Set<string>(),
  selectedNodeId: null,
  pendingCenterNodeId: null,
  validationErrors: [] as ValidationError[],
  stepsWithErrors: new Set<string>(),
  pendingNewNode: null,
  requestEditNodeId: null,
  resizeTracking: {},
  lastStepRename: null,
};

export const useWorkflowStore = create<WorkflowState>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // State Management
      setExecutionGraph: (graph) =>
        set((state) => {
          const { nodes, edges } = executionGraphToReactFlow(graph);
          state.executionGraph = graph;
          state.nodes = nodes;
          state.edges = edges;
          state.isDirty = false;
          state.isStructurallyDirty = false;
        }),

      resetState: () => set(() => initialState),

      clearDirtyFlag: (savedRevision?: number) =>
        set((state) => {
          // A save clears only what it carried: an edit made while it was in
          // flight moved the revision on, and is still unsaved.
          if (
            savedRevision !== undefined &&
            savedRevision !== state.dirtyRevision
          ) {
            return;
          }
          state.isDirty = false;
          state.isStructurallyDirty = false;
        }),

      setStagedNodeIds: (ids: Set<string>) =>
        set((state) => {
          state.stagedNodeIds = ids;
        }),

      setSelectedNodeId: (nodeId: string | null) =>
        set((state) => {
          state.selectedNodeId = nodeId;
        }),

      setPendingCenterNodeId: (nodeId: string | null) =>
        set((state) => {
          state.pendingCenterNodeId = nodeId;
        }),

      setPendingNewNode: (node) =>
        set((state) => {
          state.pendingNewNode = node;
        }),

      setRequestEditNodeId: (nodeId) =>
        set((state) => {
          state.requestEditNodeId = nodeId;
        }),

      // Validation Errors
      setValidationErrors: (errors: ValidationError[]) =>
        set((state) => {
          // Errors name DSL step ids; a step id may repeat across Split,
          // While and onWait bodies, so resolve each to its canvas node by
          // the body the validator reports.
          const findStepNode = createGraphNodeResolver(state.nodes);
          errors = errors.map((error) => ({
            ...error,
            stepId: error.stepId
              ? (findStepNode(error.stepId, error.graphPath) ?? error.stepId)
              : error.stepId,
            relatedStepIds: error.relatedStepIds?.map(
              (id) => findStepNode(id, error.graphPath) ?? id
            ),
          }));
          state.validationErrors = errors;
          // Build a Set of step IDs that have errors for quick lookup
          const stepIds = new Set<string>();
          errors.forEach((error) => {
            if (error.stepId) {
              stepIds.add(error.stepId);
            }
            // Also include related step IDs
            if (error.relatedStepIds) {
              error.relatedStepIds.forEach((id) => stepIds.add(id));
            }
          });
          state.stepsWithErrors = stepIds;
        }),

      clearValidationErrors: () =>
        set((state) => {
          state.validationErrors = [];
          state.stepsWithErrors = new Set<string>();
        }),

      getFirstErrorStepId: () => {
        const state = get();
        // Find the first validation error that has a stepId
        const firstError = state.validationErrors.find((e) => e.stepId);
        return firstError?.stepId || null;
      },

      // Node Operations
      addNode: (step, position, parentId) => {
        const nodeId =
          step.id ||
          generateStepId(
            step.name as string | undefined,
            get().nodes.map((node) => node.id)
          );
        set((state) => {
          const nodeType = step.stepType
            ? STEP_TYPES[step.stepType as keyof typeof STEP_TYPES] ||
              NODE_TYPES.BasicNode
            : NODE_TYPES.BasicNode;
          const size = NODE_TYPE_SIZES[nodeType] || { width: 180, height: 48 }; // Pill fallback (15*12 x 4*12)

          // Position should already be in the correct coordinate space:
          // - Relative if parentId is provided
          // - Absolute if no parentId
          // Callers are responsible for conversion
          const snappedPosition = snapPositionToGrid(position);

          const newNode: Node = {
            id: nodeId,
            type: nodeType,
            position: snappedPosition,
            data: {
              ...step,
              id: nodeId,
              // Keep inputMapping as array for React Flow nodes
              inputMapping: step.inputMapping || [],
            },
            width: snapToGrid(size.width), // Explicit width to prevent auto-sizing
            height: snapToGrid(size.height), // Explicit height to prevent auto-sizing
            style: {
              width: snapToGrid(size.width), // Snap width to grid
              height: snapToGrid(size.height), // Snap height to grid
            },
            ...(parentId && { parentId, extent: 'parent', expandParent: true }),
          };

          state.nodes.push(newNode);

          // If node has a parent, expand parent to fit all children
          if (parentId) {
            expandParentToFitChildren(state.nodes, parentId);
          }

          markDirty(state);
          state.isStructurallyDirty = true;
        });
        return nodeId;
      },

      updateNode: (nodeId, updates) =>
        set((state) => {
          const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
          if (nodeIndex !== -1) {
            // Update node type if stepType changed
            if (
              updates.stepType &&
              updates.stepType !== state.nodes[nodeIndex].data.stepType
            ) {
              const nodeType =
                STEP_TYPES[updates.stepType as keyof typeof STEP_TYPES] ||
                NODE_TYPES.BasicNode;
              state.nodes[nodeIndex].type = nodeType;
            }

            state.nodes[nodeIndex].data = {
              ...state.nodes[nodeIndex].data,
              ...updates,
              // Keep inputMapping as array for React Flow nodes
            };
            markDirty(state);
            state.isStructurallyDirty = true;
          }
        }),

      convertNodeToContainer: (nodeId) =>
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId);
          if (!node || node.type === NODE_TYPES.ContainerNode) {
            return;
          }

          const containerSize = NODE_TYPE_SIZES[NODE_TYPES.ContainerNode];
          const width = snapToGrid(
            Math.max(
              typeof node.width === 'number' ? node.width : 0,
              containerSize.width
            )
          );
          const height = snapToGrid(
            Math.max(
              typeof node.height === 'number' ? node.height : 0,
              containerSize.height
            )
          );

          node.type = NODE_TYPES.ContainerNode;
          node.width = width;
          node.height = height;
          node.style = { ...node.style, width, height };
          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      removeNode: (nodeId) =>
        set((state) => {
          const removedNodes = new Set([nodeId]);
          let foundDescendant = true;

          while (foundDescendant) {
            foundDescendant = false;
            for (const node of state.nodes) {
              if (
                node.parentId &&
                removedNodes.has(node.parentId) &&
                !removedNodes.has(node.id)
              ) {
                removedNodes.add(node.id);
                foundDescendant = true;
              }
            }
          }

          // Collect hidden tool/memory target nodes that will become orphaned.
          // These are targets of edges from removed nodes with non-standard
          // sourceHandles (tool names or 'memory') that have no other incoming
          // edges from nodes that will remain.
          const outgoingHiddenTargets = new Set<string>();
          for (const edge of state.edges) {
            if (
              removedNodes.has(edge.source) &&
              edge.sourceHandle &&
              edge.sourceHandle !== 'source'
            ) {
              const targetId = edge.target;
              const hasOtherIncoming = state.edges.some(
                (e) => e.target === targetId && !removedNodes.has(e.source)
              );
              if (!hasOtherIncoming) {
                outgoingHiddenTargets.add(targetId);
              }
            }
          }

          outgoingHiddenTargets.forEach((targetId) =>
            removedNodes.add(targetId)
          );

          // Remove the node, its descendants, and orphaned tool/memory targets
          state.nodes = state.nodes.filter(
            (node) => !removedNodes.has(node.id)
          );

          // Remove edges connected to any of the removed nodes
          state.edges = state.edges.filter(
            (e) => !removedNodes.has(e.source) && !removedNodes.has(e.target)
          );

          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      renameStep: (oldId, newId) => {
        const current = get();
        const node = current.nodes.find((n) => n.id === oldId);
        if (!node) {
          return `Step '${oldId}' was not found`;
        }
        const validationError = getStepIdValidationError(
          newId,
          oldId,
          current.nodes.map((n) => n.id)
        );
        if (validationError) {
          return validationError;
        }

        // A node whose step id is shared with a step in another scope has a
        // qualified canvas id (see canvasNodeStepId). References to its real
        // step id are rewritten only among its siblings, where they resolve
        // to it; elsewhere the same id names the other step.
        const oldStepId = canvasNodeStepId(oldId);
        const siblingIds =
          oldStepId === oldId
            ? null
            : new Set(
                current.nodes
                  .filter((n) => n.parentId === node.parentId)
                  .map((n) => n.id)
              );
        const rewriteSiblingReferences = <T>(value: T, inScope: boolean): T =>
          inScope
            ? (rewriteStepReferencesDeep(value, oldStepId, newId) as T)
            : value;

        set((state) => {
          const remapId = (id: string) => (id === oldId ? newId : id);

          // Rename the node (React Flow id + data.id), re-point children of
          // containers (Split/While subgraph membership lives in parentId),
          // and rewrite step references in every node's data.
          for (const n of state.nodes) {
            const isRenamedNode = n.id === oldId;
            const inScope = siblingIds?.has(n.id) ?? false;
            if (isRenamedNode) {
              n.id = newId;
            }
            if (n.parentId === oldId) {
              n.parentId = newId;
            }
            if (n.data && typeof n.data === 'object') {
              const data = rewriteSiblingReferences(
                rewriteStepReferencesDeep(n.data, oldId, newId),
                inScope
              ) as Record<string, unknown>;
              if (isRenamedNode && data.id === oldStepId) {
                data.id = newId;
              }
              n.data = data;
            }
          }

          // Re-point edges and rewrite references in edge data (execution
          // plan edge conditions live in edge.data.condition).
          const untouchedEdgeIds = new Set(
            state.edges
              .filter((e) => e.source !== oldId && e.target !== oldId)
              .map((e) => e.id)
          );
          const assignedEdgeIds = new Set<string>();
          const edgeIdRemap = new Map<string, string>();
          for (const e of state.edges) {
            const endpointsTouched = e.source === oldId || e.target === oldId;
            const inScope =
              (siblingIds?.has(e.source) && siblingIds.has(e.target)) ?? false;
            e.source = remapId(e.source);
            e.target = remapId(e.target);
            if (e.data && typeof e.data === 'object') {
              e.data = rewriteSiblingReferences(
                rewriteStepReferencesDeep(e.data, oldId, newId),
                inScope
              ) as typeof e.data;
            }
            if (endpointsTouched) {
              // Regenerate the edge id so the `${source}-${target}-${handle}`
              // convention keeps holding (string surgery on the old id would
              // be ambiguous for ids containing hyphens).
              const base = `${e.source}-${e.target}-${e.sourceHandle ?? 'default'}`;
              let candidate = base;
              let counter = 1;
              while (
                untouchedEdgeIds.has(candidate) ||
                assignedEdgeIds.has(candidate)
              ) {
                candidate = `${base}-${counter}`;
                counter += 1;
              }
              assignedEdgeIds.add(candidate);
              edgeIdRemap.set(e.id, candidate);
              e.id = candidate;
            }
          }

          // Remap auxiliary state that holds step or edge ids.
          state.selectedNodes = state.selectedNodes.map(remapId);
          state.selectedEdges = state.selectedEdges.map(
            (id) => edgeIdRemap.get(id) ?? id
          );
          if (state.selectedNodeId === oldId) {
            state.selectedNodeId = newId;
          }
          if (state.pendingCenterNodeId === oldId) {
            state.pendingCenterNodeId = newId;
          }
          if (state.requestEditNodeId === oldId) {
            state.requestEditNodeId = newId;
          }
          if (state.stagedNodeIds.has(oldId)) {
            const nextStaged = new Set(state.stagedNodeIds);
            nextStaged.delete(oldId);
            nextStaged.add(newId);
            state.stagedNodeIds = nextStaged;
          }
          if (state.stepsWithErrors.has(oldId)) {
            const nextErrors = new Set(state.stepsWithErrors);
            nextErrors.delete(oldId);
            nextErrors.add(newId);
            state.stepsWithErrors = nextErrors;
          }
          state.validationErrors = state.validationErrors.map((error) => ({
            ...error,
            stepId: error.stepId === oldId ? newId : error.stepId,
            relatedStepIds: error.relatedStepIds
              ? error.relatedStepIds.map(remapId)
              : error.relatedStepIds,
          }));
          if (state.pendingNewNode) {
            const pending = state.pendingNewNode;
            if (pending.parentId === oldId) pending.parentId = newId;
            if (pending.sourceNodeId === oldId) pending.sourceNodeId = newId;
            if (pending.targetNodeId === oldId) pending.targetNodeId = newId;
            if (pending.insertionEdge) {
              pending.insertionEdge.source = remapId(
                pending.insertionEdge.source
              );
              pending.insertionEdge.target = remapId(
                pending.insertionEdge.target
              );
            }
            if (pending.data && typeof pending.data === 'object') {
              pending.data = rewriteStepReferencesDeep(
                pending.data,
                oldId,
                newId
              ) as typeof pending.data;
            }
          }

          // Notes attached to the renamed step stay attached to it.
          for (const n of state.nodes) {
            if (
              n.type === NODE_TYPES.NoteNode &&
              (n.data as { anchorStepId?: string }).anchorStepId === oldId
            ) {
              n.data = { ...n.data, anchorStepId: newId };
            }
          }

          state.lastStepRename = { oldId, newId };
          markDirty(state);
          state.isStructurallyDirty = true;
        });
        return null;
      },

      // Note Operations
      addNote: (position, content = '', options = {}) => {
        const noteId = uuidv4();
        set((state) => {
          const size = NODE_TYPE_SIZES[NODE_TYPES.NoteNode] || {
            width: 240,
            height: 120,
          };
          const snappedPosition = snapPositionToGrid(position);

          const newNode: Node = {
            id: noteId,
            type: NODE_TYPES.NoteNode,
            position: snappedPosition,
            data: {
              id: noteId,
              content,
              ...(options.anchorStepId
                ? { anchorStepId: options.anchorStepId }
                : {}),
              ...(options.autoEdit ? { autoEdit: true } : {}),
            },
            width: snapToGrid(size.width),
            height: snapToGrid(size.height),
            style: {
              width: snapToGrid(size.width),
              height: snapToGrid(size.height),
            },
          };

          state.nodes.push(newNode);
          markDirty(state);
          state.isStructurallyDirty = true;
        });
        return noteId;
      },

      updateNote: (noteId, patch) =>
        set((state) => {
          const note = state.nodes.find(
            (n) => n.id === noteId && n.type === NODE_TYPES.NoteNode
          );
          if (!note) return;
          const data = { ...(note.data as Record<string, unknown>) };
          delete data.autoEdit;
          if (patch.content !== undefined) data.content = patch.content;
          note.data = data;
          if (patch.width !== undefined && patch.height !== undefined) {
            note.width = patch.width;
            note.height = patch.height;
            note.style = {
              ...note.style,
              width: patch.width,
              height: patch.height,
            };
          }
          markDirty(state);
        }),

      placeNote: (noteId, position, anchorStepId) =>
        set((state) => {
          const note = state.nodes.find(
            (n) => n.id === noteId && n.type === NODE_TYPES.NoteNode
          );
          if (!note) return;
          const snapped = snapPositionToGrid(position);
          const currentAnchor =
            (note.data as { anchorStepId?: string }).anchorStepId ?? null;
          if (
            note.position.x === snapped.x &&
            note.position.y === snapped.y &&
            currentAnchor === anchorStepId
          ) {
            return;
          }
          note.position = snapped;
          const data = { ...(note.data as Record<string, unknown>) };
          if (anchorStepId) data.anchorStepId = anchorStepId;
          else delete data.anchorStepId;
          note.data = data;
          markDirty(state);
        }),

      // Edge Operations
      addEdge: (from, to, label) =>
        set((state) => {
          // Validate the connection before adding
          const validation = validateConnection(
            state.edges,
            state.nodes,
            from,
            to
          );
          if (!validation.isValid) {
            console.error(
              `Connection validation failed: ${validation.errorMessage}`
            );
            return; // Don't add the edge if validation fails
          }

          const edgeId = `${from}-${to}-${label ?? 'default'}`;
          const sourceHandle = label ?? 'source';

          const newEdge: Edge = {
            id: edgeId,
            source: from,
            target: to,
            sourceHandle,
            targetHandle: 'target',
          };

          state.edges.push(newEdge);
          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      addEdges: (edgesToAdd) =>
        set((state) => {
          // Add multiple edges at once (useful for conditional nodes)
          // Validates only the first edge to the target, then adds all edges
          if (edgesToAdd.length === 0) return;

          const firstEdge = edgesToAdd[0];
          const validation = validateConnection(
            state.edges,
            state.nodes,
            firstEdge.from,
            firstEdge.to
          );
          if (!validation.isValid) {
            console.error(
              `Connection validation failed: ${validation.errorMessage}`
            );
            return;
          }

          for (const edge of edgesToAdd) {
            const label = edge.label;
            const edgeId = `${edge.from}-${edge.to}-${label ?? 'default'}`;
            const sourceHandle = label ?? 'source';

            const newEdge: Edge = {
              id: edgeId,
              source: edge.from,
              target: edge.to,
              sourceHandle,
              targetHandle: 'target',
            };

            state.edges.push(newEdge);
          }

          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      updateEdgeData: (edgeId, updates) =>
        set((state) => {
          const edge = state.edges.find((candidate) => candidate.id === edgeId);
          if (!edge) return;

          const nextData: Record<string, unknown> = {
            ...((edge.data as Record<string, unknown> | undefined) ?? {}),
          };

          for (const [key, value] of Object.entries(updates)) {
            if (value === undefined) {
              delete nextData[key];
            } else {
              nextData[key] = value;
            }
          }

          edge.data = Object.keys(nextData).length > 0 ? nextData : undefined;
          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      removeEdge: (from, to, label) =>
        set((state) => {
          const sourceHandle = label ?? 'source';
          state.edges = state.edges.filter(
            (e) =>
              !(
                e.source === from &&
                e.target === to &&
                e.sourceHandle === sourceHandle
              )
          );
          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      insertNodeBetween: (
        sourceNodeId,
        targetNodeId,
        sourceHandle,
        newStepData,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _position
      ) =>
        set((state) => {
          // Where the step goes and what moves aside for it is geometry of
          // the canvas alone (./canvas-geometry.ts); the store says it edited.
          const inserted = insertStepBetween(state, {
            sourceNodeId,
            targetNodeId,
            sourceHandle,
            newStepData,
          });
          if (!inserted) return;
          markDirty(state);
          state.isStructurallyDirty = true;
        }),

      // React Flow Integration
      onNodesChange: (changes) => {
        // Apply selection changes directly for visual selection (needed for NodeResizer on notes)
        const selectionChanges = changes.filter((c) => c.type === 'select');
        const otherChanges = changes.filter((c) => c.type !== 'select');

        // Handle selection changes separately - apply them but don't mark dirty
        if (selectionChanges.length > 0) {
          const currentState = get();
          const nodesWithSelection = applyNodeChanges(
            selectionChanges,
            currentState.nodes
          );
          if (nodesWithSelection !== currentState.nodes) {
            set({ nodes: nodesWithSelection });
          }
        }

        // If only selection changes, we're done
        if (otherChanges.length === 0) {
          return;
        }

        const filteredChanges = otherChanges;

        // Check if this is a position-only change (drag operation)
        // Position-only changes are the most frequent and need to be fast
        const isPositionOnly = filteredChanges.every(
          (c) => c.type === 'position'
        );

        if (isPositionOnly) {
          // For position-only changes, bypass immer by using get/set directly
          // This avoids creating new references for unchanged parts of state
          const currentState = get();
          const newNodes = applyNodeChanges(
            filteredChanges,
            currentState.nodes
          );

          // Only update if nodes actually changed
          if (newNodes !== currentState.nodes) {
            set({ nodes: newNodes, ...dirtied(currentState) });
          }
          return;
        }

        // For other changes (dimensions, add, remove), use the full immer-based approach
        set((state) => {
          // Track dimension changes for ContainerNodes to handle centering and downstream shifts
          const dimensionChanges = new Map<
            string,
            {
              oldWidth: number;
              oldHeight: number;
              newWidth: number;
              newHeight: number;
              oldPosition: { x: number; y: number };
            }
          >();

          // Check if this batch has any dimension changes
          const hasDimensionChanges = filteredChanges.some(
            (c) => c.type === 'dimensions'
          );

          // Check if this batch has position changes - if so, this is a drag operation
          // and we should skip dimension change processing to prevent infinite loops
          const hasPositionChanges = filteredChanges.some(
            (c) => c.type === 'position' && c.position
          );

          // Skip dimension change processing during drag operations
          // Dimension changes during drag are React Flow's expandParent behavior,
          // not user-initiated resizing
          const shouldProcessDimensions =
            hasDimensionChanges && !hasPositionChanges;

          // If no dimension changes, clear resize tracking (resize operation finished)
          if (
            !hasDimensionChanges &&
            Object.keys(state.resizeTracking).length > 0
          ) {
            state.resizeTracking = {};
          }

          // First pass: identify nodes being resized and initialize tracking
          // Skip this during drag operations to prevent infinite loops
          filteredChanges.forEach((change) => {
            if (change.type === 'dimensions' && shouldProcessDimensions) {
              const node = state.nodes.find((n) => n.id === change.id);
              if (node && node.type === NODE_TYPES.ContainerNode) {
                // Initialize resize tracking if this is the first resize event for this node
                if (!state.resizeTracking[change.id]) {
                  const originalWidth =
                    typeof node.style?.width === 'number'
                      ? node.style.width
                      : node.width || 204;
                  const originalHeight =
                    typeof node.style?.height === 'number'
                      ? node.style.height
                      : node.height || 168;

                  // Find all downstream nodes and store their original positions
                  const downstreamNodeOriginalPositions: Record<
                    string,
                    { x: number; y: number }
                  > = {};
                  const nodesToTrack = new Set<string>();
                  const findDownstreamNodes = (currentNodeId: string) => {
                    state.edges.forEach((edge) => {
                      if (
                        edge.source === currentNodeId &&
                        !nodesToTrack.has(edge.target)
                      ) {
                        nodesToTrack.add(edge.target);
                        findDownstreamNodes(edge.target);
                      }
                    });
                  };
                  findDownstreamNodes(change.id);

                  // Store original positions of all downstream nodes
                  nodesToTrack.forEach((nodeId) => {
                    const downstreamNode = state.nodes.find(
                      (n) => n.id === nodeId
                    );
                    if (downstreamNode) {
                      downstreamNodeOriginalPositions[nodeId] = {
                        ...downstreamNode.position,
                      };
                    }
                  });

                  // Capture resize handle direction from node data
                  const resizeHandle = node.data?.__resizeHandle as
                    | {
                        isLeft: boolean;
                        isRight: boolean;
                        isTop: boolean;
                        isBottom: boolean;
                      }
                    | undefined;

                  state.resizeTracking[change.id] = {
                    originalPosition: { ...node.position },
                    originalWidth,
                    originalHeight,
                    downstreamNodeOriginalPositions,
                    resizeHandle,
                  };
                }
              }
            }
          });

          // Filter and transform changes
          const snappedChanges = filteredChanges
            .filter((change) => {
              // Block dimension changes for non-container nodes to enforce fixed sizing
              if (change.type === 'dimensions') {
                const node = state.nodes.find((n) => n.id === change.id);
                if (node && node.type !== NODE_TYPES.ContainerNode) {
                  return false; // Reject dimension changes for non-container nodes
                }

                // Skip dimension changes during drag operations to prevent infinite loops
                // During drag, React Flow fires dimension changes due to expandParent,
                // but we don't want to process them as resize operations
                if (!shouldProcessDimensions) {
                  return false;
                }

                // Only allow dimension changes during active user resize
                // __resizeHandle is set by BaseResizableNode on resize start and cleared on end
                // Without this, React Flow's re-measurement on selection can trigger
                // unwanted container resizing and downstream node shifts
                if (node && !node.data?.__resizeHandle) {
                  return false;
                }

                // Track ContainerNode dimension changes for downstream node shifting
                if (
                  node &&
                  node.type === NODE_TYPES.ContainerNode &&
                  change.dimensions
                ) {
                  // Use tracked original values, or current values if tracking not initialized
                  const tracking = state.resizeTracking[change.id];
                  const oldWidth =
                    tracking?.originalWidth ||
                    (typeof node.style?.width === 'number'
                      ? node.style.width
                      : node.width || 204);
                  const oldHeight =
                    tracking?.originalHeight ||
                    (typeof node.style?.height === 'number'
                      ? node.style.height
                      : node.height || 168);
                  const oldPosition = tracking?.originalPosition || {
                    ...node.position,
                  };

                  dimensionChanges.set(change.id, {
                    oldWidth,
                    oldHeight,
                    newWidth: change.dimensions.width,
                    newHeight: change.dimensions.height,
                    oldPosition,
                  });
                }
              }
              return true;
            })
            .map((change) => {
              // Snap container dimension changes to grid
              if (change.type === 'dimensions' && change.dimensions) {
                return {
                  ...change,
                  dimensions: {
                    width: snapToGrid(change.dimensions.width),
                    height: snapToGrid(change.dimensions.height),
                  },
                };
              }
              // Snap position changes to grid
              if (change.type === 'position' && change.position) {
                return {
                  ...change,
                  position: snapPositionToGrid(change.position),
                };
              }
              return change;
            });

          // Apply the changes first
          state.nodes = applyNodeChanges(snappedChanges, state.nodes);

          // Handle ContainerNode resizing: edge-based resizing based on handle direction
          dimensionChanges.forEach((changeInfo, nodeId) => {
            const { oldWidth, newWidth } = changeInfo;
            const widthDelta = newWidth - oldWidth;

            if (widthDelta !== 0) {
              const tracking = state.resizeTracking[nodeId];
              const handle = tracking?.resizeHandle;

              // React Flow's NodeResizer already handles position correctly:
              // - Right edge drag: keeps left edge fixed (position.x unchanged)
              // - Left edge drag: keeps right edge fixed (adjusts position.x)
              // We only need to shift downstream nodes based on how the right edge moved

              // Calculate how much the right edge moved in absolute coordinates
              let rightEdgeShift = 0;

              if (handle) {
                if (handle.isRight && !handle.isLeft) {
                  // Right edge drag: right edge moved by full widthDelta
                  rightEdgeShift = widthDelta;
                } else if (handle.isLeft && !handle.isRight) {
                  // Left edge drag: right edge stayed in place (growth went left)
                  rightEdgeShift = 0;
                } else {
                  // Corner drag or both edges: shouldn't happen with standard handles
                  rightEdgeShift = widthDelta / 2;
                }
              }

              // Shift downstream nodes based on right edge movement
              if (
                rightEdgeShift !== 0 &&
                tracking?.downstreamNodeOriginalPositions
              ) {
                state.nodes.forEach((node) => {
                  const originalPos =
                    tracking.downstreamNodeOriginalPositions[node.id];
                  if (originalPos) {
                    node.position = {
                      x: originalPos.x + rightEdgeShift,
                      y: node.position.y, // Keep Y unchanged
                    };
                  }
                });
              }
            }
          });

          // Only mark as dirty for dimension, add, remove changes
          // Position-only changes are handled in the fast path above
          // Use snappedChanges (not filteredChanges) so that dimension events
          // already filtered out for non-container nodes don't falsely set dirty
          const hasUserChanges = snappedChanges.some(
            (change) =>
              change.type === 'dimensions' ||
              change.type === 'remove' ||
              change.type === 'add'
          );
          if (hasUserChanges) {
            markDirty(state);
            state.isStructurallyDirty = true;
          }
        });
      },

      onEdgesChange: (changes) =>
        set((state) => {
          // Filter out selection changes to prevent unnecessary re-renders
          const filteredChanges = changes.filter(
            (change) => change.type !== 'select'
          );

          // If only selection changes, skip the update entirely
          if (filteredChanges.length === 0) {
            return;
          }

          state.edges = applyEdgeChanges(filteredChanges, state.edges);
          // Only mark as dirty for actual edge changes
          const hasUserChanges = filteredChanges.some(
            (change) => change.type === 'remove' || change.type === 'add'
          );
          if (hasUserChanges) {
            markDirty(state);
            state.isStructurallyDirty = true;
          }
        }),

      // Selection
      setSelectedNodes: (nodeIds) =>
        set((state) => {
          state.selectedNodes = nodeIds;
        }),

      setSelectedEdges: (edgeIds) =>
        set((state) => {
          state.selectedEdges = edgeIds;
        }),

      // Synchronization
      syncFromReactFlow: (nodes, edges) =>
        set((state) => {
          state.nodes = nodes;
          state.edges = edges;
          state.executionGraph = composeExecutionGraph(nodes, edges);
          // Don't mark as dirty when syncing from external data (e.g., initial load)
          state.isDirty = false;
          state.isStructurallyDirty = false;
        }),

      getReactFlowElements: () => {
        const state = get();
        return { nodes: state.nodes, edges: state.edges };
      },

      // Layout
      applyAutoLayout: () =>
        set((state) => {
          // Identify hidden AI Agent tool/memory nodes and edges
          // These are rendered inline in the AI Agent card, not on the canvas
          const hiddenNodeIds = new Set<string>();
          const hiddenEdgeIds = new Set<string>();
          const aiAgentNodes = state.nodes.filter(
            (n) => n.type === NODE_TYPES.AiAgentNode
          );
          for (const agentNode of aiAgentNodes) {
            for (const edge of state.edges) {
              // 'onError' routes stay visible on the canvas (normal error
              // branch), so they participate in layout like any other edge.
              if (
                edge.source === agentNode.id &&
                edge.sourceHandle &&
                edge.sourceHandle !== 'source' &&
                edge.sourceHandle !== 'onError'
              ) {
                hiddenEdgeIds.add(edge.id);
                hiddenNodeIds.add(edge.target);
              }
            }
          }

          // Layout only visible nodes and edges
          const visibleNodes = state.nodes.filter(
            (n) => !hiddenNodeIds.has(n.id)
          );
          const visibleEdges = state.edges.filter(
            (e) => !hiddenEdgeIds.has(e.id)
          );

          const { nodes: layoutedNodes } = getLayoutedElements(
            visibleNodes,
            visibleEdges
          );

          // Merge layouted visible nodes back with hidden nodes (unchanged)
          const layoutedMap = new Map(layoutedNodes.map((n) => [n.id, n]));
          state.nodes = state.nodes.map((n) => layoutedMap.get(n.id) ?? n);
          markDirty(state);
        }),
    })),
    {
      name: 'workflow-store',
    }
  )
);

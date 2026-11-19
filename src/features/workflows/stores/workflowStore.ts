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
import { createStore } from 'zustand';
import { editorStore } from './editor-scope';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { applyEdgeChanges, applyNodeChanges, Edge, Node } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
import {
  canvasNodeStepId,
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
  applyCanvasNodeChanges,
  expandParentToFitChildren,
  insertStepBetween,
} from './canvas-geometry';

/** Marks the workflow edited. Every edit goes through here or `dirtied`. */
function markDirty(state: { isDirty: boolean; dirtyRevision: number }) {
  state.isDirty = true;
  state.dirtyRevision += 1;
}

/** The dirty fields for a plain `setState` that edits the workflow. */
export function dirtied(state: { dirtyRevision: number }) {
  return { isDirty: true, dirtyRevision: state.dirtyRevision + 1 } as const;
}

// State holds a Set (stagedNodeIds); renameStep reads it
// inside an immer draft, which requires the MapSet plugin.
enableMapSet();

const initialState = {
  nodes: [],
  edges: [],
  isDirty: false,
  isStructurallyDirty: false,
  dirtyRevision: 0,
  stagedNodeIds: new Set<string>(),
  selectedNodeId: null,
  pendingCenterNodeId: null,
  pendingNewNode: null,
  requestEditNodeId: null,
  resizeTracking: {},
  lastStepRename: null,
};

export const useWorkflowStore = editorStore('workflow', () =>
  createStore<WorkflowState>()(
    devtools(
      immer((set, get) => ({
        ...initialState,

        // State Management
        setExecutionGraph: (graph) =>
          set((state) => {
            const { nodes, edges } = executionGraphToReactFlow(graph);
            state.nodes = nodes;
            state.edges = edges;
            state.isDirty = false;
            state.isStructurallyDirty = false;
          }),

        resetState: () => set(() => initialState),

        editNodes: (update, options) => {
          const nodes = update(get().nodes);
          set((state) => {
            state.nodes = nodes;
            markDirty(state);
            if (options?.structural) state.isStructurallyDirty = true;
          });
        },

        revertNodes: (update, dirtyBefore) => {
          const nodes = update(get().nodes);
          set((state) => {
            state.nodes = nodes;
            if (dirtyBefore) {
              state.isDirty = dirtyBefore.isDirty;
              state.isStructurallyDirty = dirtyBefore.isStructurallyDirty;
            }
          });
        },

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
            const size = NODE_TYPE_SIZES[nodeType] || {
              width: 180,
              height: 48,
            }; // Pill fallback (15*12 x 4*12)

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
              ...(parentId && {
                parentId,
                extent: 'parent',
                expandParent: true,
              }),
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
          const rewriteSiblingReferences = <T>(
            value: T,
            inScope: boolean
          ): T =>
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
            for (const e of state.edges) {
              const endpointsTouched = e.source === oldId || e.target === oldId;
              const inScope =
                (siblingIds?.has(e.source) && siblingIds.has(e.target)) ??
                false;
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
                e.id = candidate;
              }
            }

            // Remap auxiliary state that holds step or edge ids.
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
            const edge = state.edges.find(
              (candidate) => candidate.id === edgeId
            );
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
            // Snapping, container resizing and what moves aside for it is
            // geometry (./canvas-geometry.ts); it hands back what it applied.
            const snappedChanges = applyCanvasNodeChanges(
              state,
              filteredChanges
            );

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
  )
);

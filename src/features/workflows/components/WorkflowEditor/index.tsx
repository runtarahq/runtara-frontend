import { useCanvasLayout } from './useCanvasLayout';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeTypes,
  Node,
  NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  OnConnectEnd,
} from '@xyflow/react';
import { useWorkflowStore } from '@/features/workflows/stores/workflowStore.ts';
import { useExecutionStore } from '@/features/workflows/stores/executionStore';
import { useValidationStore } from '@/features/workflows/stores/validationStore';
import { toast } from 'sonner';
import { useIsDarkTheme } from '@/shared/stores/themeStore';
import {
  NODE_TYPE_SIZES,
  NODE_TYPES,
  STEP_TYPES,
} from '@/features/workflows/config/workflow.ts';
import {
  SNAP_GRID_SIZE,
  snapPositionToGrid,
} from '@/features/workflows/config/workflow-editor.ts';
import { validateConnection } from '@/features/workflows/utils/graph-validation';

import * as form from './NodeForm/NodeFormItem.tsx';
import {
  AnimatedSVGEdge,
  ImprovedEdge,
  EdgeContextProvider,
} from './CustomEdges';
import {
  BasicNode,
  ConditionalNode,
  ContainerNode,
  CreateNode,
  SwitchNode,
  AiAgentNode,
  NoteNode,
  StartIndicatorNode,
} from './CustomNodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import { useEditingNode } from './use-editing-node';
import { preloadRustValidation } from '@/shared/lib/rust-validation-wasm';
import { applyStepEdit, stepEditOf } from './apply-step-edit';
import {
  CANVAS_FIT_VIEW_OPTIONS,
  CANVAS_MIN_ZOOM,
  useCanvasFit,
} from './use-canvas-fit';
import {
  pendingStepEdges,
  planPendingStep,
  type CreateStepContext,
} from './pending-step';
import { editorLostItsStep } from './editor-lost-step';
import { DiscardStepChangesDialog } from './NodeConfigPanel/DiscardStepChangesDialog';
import { NodeFormProvider } from './NodeForm/NodeFormProvider';
import { StepPickerModal, StepPickerResult } from './NodeForm/StepPickerModal';
import { NodeConfigProvider } from './NodeConfigContext';
import { CanvasDisplayProvider } from './CanvasDisplayContext';
import type { EdgeRouteActions } from './CustomEdges/EdgeContext';
import { composeConditionSuggestions } from './NodeForm/InputMappingValueField/VariableSuggestions';
import {
  resolveContainerScope,
  splitItemSchemaFieldsFromScope,
  type ScopeNode,
} from '@/features/workflows/utils/container-scope';
import type { CanvasDetailLevel } from './CustomNodes/node-size';
import { registerScreenToCanvas } from './canvas-bridge';
import {
  findAttachTarget,
  noteAnchorStepId,
  placementForDrop,
  stepRects,
} from './CustomNodes/note-placement';
import { CANVAS_Z } from '@/features/workflows/components/WorkflowEditor/canvas-z';
import {
  validateNodeEditWithRust,
  type PendingNodeCandidate,
} from './node-edit-rust-validation';

const nodeTypes: NodeTypes = {
  [NODE_TYPES.BasicNode]: BasicNode,
  [NODE_TYPES.CreateNode]: CreateNode,
  [NODE_TYPES.ConditionalNode]: ConditionalNode,
  [NODE_TYPES.SwitchNode]: SwitchNode,
  [NODE_TYPES.ContainerNode]: ContainerNode,
  [NODE_TYPES.AiAgentNode]: AiAgentNode,
  [NODE_TYPES.NoteNode]: NoteNode,
  [NODE_TYPES.StartIndicatorNode]: StartIndicatorNode,
};

const edgeTypes: EdgeTypes = {
  default: ImprovedEdge,
  animated: AnimatedSVGEdge,
};

type WorkflowEditorProps = {
  nodes: Node[];
  edges: Edge[];
  readOnly?: boolean;
  /** When true, allows selecting executed nodes for inspection (but not editing) */
  debugInspectMode?: boolean;
  workflow?: {
    id: string;
    name: string;
    description?: string;
    variables?: Array<{
      name: string;
      value: unknown;
      type: string;
      description?: string | null;
    }>;
    inputSchemaFields?: Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
      nullable?: boolean;
    }>;
    outputSchemaFields?: Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
      nullable?: boolean;
    }>;
    stateSchemaFields?: Array<{
      name: string;
      type: string;
      required: boolean;
      description: string;
      nullable?: boolean;
      label?: string;
      format?: string;
      enum?: unknown[];
    }>;
    executionTimeoutSeconds?: number;
    rateLimitBudgetMs?: number;
    durable?: boolean | null;
    entryPoint?: string;
  };
  /** Stages workflow-level changes the canvas makes, such as a new entry point. */
  onWorkflowChange?: (changes: { entryPoint?: string }) => void;
  /** How much each step card shows; the switch lives in the page header. */
  canvasDetail?: CanvasDetailLevel;
};

export function WorkflowEditor(props: WorkflowEditorProps) {
  // The editor validates on every step save: fetch the validator as it opens.
  useEffect(() => preloadRustValidation(), []);
  return (
    <ReactFlowProvider>
      <WorkflowEditorContent {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowEditorContent({
  nodes: initialNodes,
  edges: initialEdges,
  readOnly = false,
  debugInspectMode = false,
  workflow,
  onWorkflowChange,
  canvasDetail = 'detailed',
}: WorkflowEditorProps) {
  const isDark = useIsDarkTheme();
  // Context for creating new steps
  const [createStepContext, setCreateStepContext] =
    useState<CreateStepContext | null>(null);

  // Track selected edge ID for showing "+" button
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Dialog states
  const {
    editingNodeId,
    setEditingNodeId,
    editNode,
    closeEditor: closeNodeConfig,
    setDirty: handleEditorDirtyChange,
    switchTargetId,
    confirmSwitch,
    cancelSwitch,
  } = useEditingNode();
  const [showStepPicker, setShowStepPicker] = useState(false);

  // Pending new node state from store (for deferred creation until user confirms)
  const pendingNewNode = useWorkflowStore((state) => state.pendingNewNode);
  const setPendingNewNode = useWorkflowStore(
    (state) => state.setPendingNewNode
  );

  // Callback for child node components to open config dialogs (including hidden nodes)
  // Opening an editor abandons any half-finished create. The pending node has
  // to go with the rest of that state: it is what the create panel renders
  // from, and leaving it set puts two config panels on screen at once.
  const openNodeConfig = useCallback(
    (nodeId: string) => {
      if (workflow && !readOnly && editNode(nodeId)) {
        setCreateStepContext(null);
        setPendingNewNode(null);
      }
    },
    [workflow, readOnly, setPendingNewNode, editNode]
  );
  // Memory picked for an AI Agent, until its editor is saved or left. It
  // used to go straight into the workflow with no way to back out (ED-30).
  const memoryDraftRef = useRef<{ agentId: string; revert: () => void } | null>(
    null
  );
  const configureNewMemory = useCallback(
    (agentId: string, revert: () => void) => {
      memoryDraftRef.current = { agentId, revert };
      openNodeConfig(agentId);
    },
    [openNodeConfig]
  );
  const nodeConfigContextValue = useMemo(
    () => ({ openNodeConfig, configureNewMemory }),
    [openNodeConfig, configureNewMemory]
  );

  const ref = useRef(null);

  // Get state from Zustand store
  const nodes = useWorkflowStore((state) => state.nodes);
  // Rebuilt only when a step is added, removed, renamed or retyped, so cards
  // do not all re-render on every selection or position change.
  const stepIndexKey = useMemo(
    () =>
      JSON.stringify(
        nodes.map((node) => [
          node.id,
          (node.data as { name?: string })?.name ?? '',
          (node.data as { stepType?: string })?.stepType ?? '',
        ])
      ),
    [nodes]
  );
  const canvasDisplayValue = useMemo(() => {
    const entries = JSON.parse(stepIndexKey) as Array<[string, string, string]>;
    return {
      detailLevel: canvasDetail,
      stepPreviews: true,
      editable: !readOnly && !!workflow,
      stepNames: new Map(
        entries.filter(([, name]) => name).map(([id, name]) => [id, name])
      ),
      stepTypes: new Map(entries.map(([id, , stepType]) => [id, stepType])),
    };
  }, [canvasDetail, readOnly, stepIndexKey, workflow]);
  const edges = useWorkflowStore((state) => state.edges);
  const pendingCenterNodeId = useWorkflowStore(
    (state) => state.pendingCenterNodeId
  );

  // Get actions from store
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange);
  const addNode = useWorkflowStore((state) => state.addNode);
  const addStoreEdge = useWorkflowStore((state) => state.addEdge);
  const addStoreEdges = useWorkflowStore((state) => state.addEdges);
  const insertNodeBetween = useWorkflowStore(
    (state) => state.insertNodeBetween
  );
  const syncFromReactFlow = useWorkflowStore(
    (state) => state.syncFromReactFlow
  );
  const setSelectedNodeId = useWorkflowStore(
    (state) => state.setSelectedNodeId
  );
  const setPendingCenterNodeId = useWorkflowStore(
    (state) => state.setPendingCenterNodeId
  );
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const placeNote = useWorkflowStore((state) => state.placeNote);

  const { getIntersectingNodes, screenToFlowPosition, setCenter, getZoom } =
    useReactFlow();
  const reactFlowStore = useStoreApi();

  // Let the toolbar (outside this ReactFlowProvider) map screen points onto
  // this canvas — it places new notes in the visible middle of it.
  useEffect(() => {
    registerScreenToCanvas(screenToFlowPosition);
    return () => registerScreenToCanvas(null);
  }, [screenToFlowPosition]);

  // Show step picker when createStepContext changes
  useEffect(() => {
    if (createStepContext && !readOnly) {
      setShowStepPicker(true);
    } else {
      setShowStepPicker(false);
    }
  }, [createStepContext, readOnly]);

  // Get editing node data
  const editingNodeData = useMemo(() => {
    if (!editingNodeId) return null;
    const node = nodes.find((n) => n.id === editingNodeId);
    if (!node) return null;
    return {
      id: editingNodeId,
      parentId: node.parentId,
      data: node.data as form.SchemaType,
      originalData: node.data as form.SchemaType,
    };
  }, [editingNodeId, nodes]);

  // Keep the config dialog/panel bound to the step being edited when its id
  // is renamed (renameStep changes the node id in the store immediately).
  const lastStepRename = useWorkflowStore((state) => state.lastStepRename);
  useEffect(() => {
    if (!lastStepRename) return;
    setEditingNodeId((current) =>
      current === lastStepRename.oldId ? lastStepRename.newId : current
    );
    // Keyed on the rename event only so a stale rename is never re-applied
    // to a step that later reuses the freed id. (The setter is stable.)
  }, [lastStepRename, setEditingNodeId]);

  // Close the editor once its step is gone, so it does not linger unseen and
  // reopen on a later single click (ED-2).
  useEffect(() => {
    if (
      editorLostItsStep(
        editingNodeId,
        nodes.map((node) => node.id),
        lastStepRename
      )
    ) {
      closeNodeConfig();
    }
  }, [editingNodeId, nodes, lastStepRename, closeNodeConfig]);

  const closeCreateStep = useCallback(() => {
    setCreateStepContext(null);
    setSelectedEdgeId(null);
    setShowStepPicker(false);
  }, []);

  // Handle backspace/delete key to remove selected node
  useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;

      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();

      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        tagName === 'button' ||
        target.isContentEditable ||
        target.closest('[role="textbox"]') ||
        target.closest('[role="combobox"]') ||
        target.closest('[role="listbox"]') ||
        target.closest('[role="menu"]') ||
        target.closest('[role="dialog"]')
      ) {
        return;
      }

      const { selectedNodeId: currentSelectedNodeId, nodes: currentNodes } =
        useWorkflowStore.getState();

      if (!currentSelectedNodeId) return;

      const selectedNode = currentNodes.find(
        (n) => n.id === currentSelectedNodeId
      );
      if (!selectedNode) return;

      if (
        selectedNode.type === NODE_TYPES.StartIndicatorNode ||
        selectedNode.type === NODE_TYPES.CreateNode
      ) {
        return;
      }

      e.preventDefault();
      removeNode(currentSelectedNodeId);
      setSelectedNodeId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [readOnly, removeNode, setSelectedNodeId]);

  // Center viewport on newly created node
  useEffect(() => {
    if (!pendingCenterNodeId) return;

    const { selectedNodeId: currentSelectedNodeId, nodes: currentNodes } =
      useWorkflowStore.getState();

    if (currentSelectedNodeId !== pendingCenterNodeId) return;

    const targetNode = currentNodes.find((n) => n.id === pendingCenterNodeId);
    if (!targetNode) return;

    setPendingCenterNodeId(null);

    const nodeType = targetNode.type || NODE_TYPES.BasicNode;
    const nodeSize = NODE_TYPE_SIZES[nodeType] || { width: 180, height: 48 };

    let absoluteX = targetNode.position.x;
    let absoluteY = targetNode.position.y;

    if (targetNode.parentId) {
      const parent = currentNodes.find((n) => n.id === targetNode.parentId);
      if (parent) {
        absoluteX += parent.position.x;
        absoluteY += parent.position.y;
      }
    }

    const nodeCenterX = absoluteX + nodeSize.width / 2;
    const nodeCenterY = absoluteY + nodeSize.height / 2;

    const zoom = getZoom();

    setTimeout(() => {
      setCenter(nodeCenterX, nodeCenterY, { zoom, duration: 300 });
    }, 100);
  }, [pendingCenterNodeId, getZoom, setCenter, setPendingCenterNodeId]);

  const {
    visibleCanvasNodes,
    layoutedCanvasNodes,
    layoutedCanvasEdgeRoutes,
    nodesWithStartIndicator,
    edgesWithStartIndicator,
    setNoteDrag,
  } = useCanvasLayout({
    nodes,
    edges,
    entryPoint: workflow?.entryPoint,
    canvasDetail,
    readOnly,
    selectedEdgeId,
    setCreateStepContext,
  });

  // Initialize store with provided nodes and edges
  const lastSyncedDataRef = useRef<string>('');

  useEffect(() => {
    const dataHash = JSON.stringify({
      nodeIds: initialNodes.map((n) => n.id).sort(),
      edgeIds: initialEdges.map((e) => e.id).sort(),
      nodeCount: initialNodes.length,
      edgeCount: initialEdges.length,
      // Include node data to detect content changes when switching versions
      // (nodes may have same IDs but different step configurations)
      nodeData: initialNodes.map((n) => ({ id: n.id, data: n.data })),
    });

    if (dataHash !== lastSyncedDataRef.current) {
      syncFromReactFlow(initialNodes, initialEdges);
      lastSyncedDataRef.current = dataHash;
    }
  }, [initialNodes, initialEdges, syncFromReactFlow]);

  const canvasLayoutKey = useMemo(
    () =>
      JSON.stringify({
        nodes: nodesWithStartIndicator.map((node) => ({
          id: node.id,
          type: node.type,
          parentId: node.parentId,
          position: node.position,
          width: node.width ?? node.style?.width,
          height: node.height ?? node.style?.height,
        })),
        edges: edgesWithStartIndicator.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
      }),
    [edgesWithStartIndicator, nodesWithStartIndicator]
  );

  // Fits the view to the workflow when its steps or the detail level change
  // (./use-canvas-fit.ts).
  useCanvasFit({
    nodes: nodesWithStartIndicator,
    edges: edgesWithStartIndicator,
    canvasDetail,
    visibleNodeCount: visibleCanvasNodes.length,
  });

  useEffect(() => {
    // React Flow needs handle bounds before it can draw edges. In the locked
    // auto-layout canvas, those measurements are render-only and must not flow
    // back into the workflow store.
    const refreshNodeInternals = () => {
      const { domNode, updateNodeInternals } = reactFlowStore.getState();
      if (!domNode) return;

      const nodeElements = new Map<string, HTMLDivElement>();
      domNode
        .querySelectorAll<HTMLDivElement>('.react-flow__node[data-id]')
        .forEach((nodeElement) => {
          const nodeId = nodeElement.getAttribute('data-id');
          if (nodeId) {
            nodeElements.set(nodeId, nodeElement);
          }
        });

      const updates = new Map();
      nodesWithStartIndicator.forEach((node) => {
        const nodeElement = nodeElements.get(node.id);
        if (nodeElement) {
          updates.set(node.id, {
            id: node.id,
            nodeElement,
            force: true,
          });
        }
      });

      if (updates.size > 0) {
        updateNodeInternals(updates, { triggerFitView: false });
      }
    };

    const animationFrameId = window.requestAnimationFrame(refreshNodeInternals);
    const timeoutIds = [50, 250, 750].map((delay) =>
      window.setTimeout(refreshNodeInternals, delay)
    );

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [canvasLayoutKey, nodesWithStartIndicator, reactFlowStore]);

  const onConnect = useCallback(
    (connection: Edge | Connection) => {
      if ('source' in connection && 'target' in connection) {
        const validation = validateConnection(
          edges,
          nodes,
          connection.source!,
          connection.target!
        );

        if (!validation.isValid) {
          toast.error('Invalid Connection', {
            description: validation.errorMessage,
          });
          return;
        }

        addStoreEdge(
          connection.source!,
          connection.target!,
          connection.sourceHandle || undefined
        );
      }
    },
    [addStoreEdge, edges, nodes]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target) return false;

      const validation = validateConnection(
        edges,
        nodes,
        connection.source,
        connection.target
      );

      return validation.isValid;
    },
    [edges, nodes]
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (!connectionState.toNode && ref.current) {
        const { fromNode, fromHandle } = connectionState;

        if (fromNode) {
          const sourceNode = nodes.find((n) => n.id === fromNode.id);
          if (!sourceNode) return;

          const clientX =
            'clientX' in event ? event.clientX : event.touches?.[0]?.clientX;
          const clientY =
            'clientY' in event ? event.clientY : event.touches?.[0]?.clientY;

          if (clientX === undefined || clientY === undefined) return;

          const mousePosition = screenToFlowPosition({
            x: clientX,
            y: clientY,
          });
          const draggedUp = mousePosition.y < sourceNode.position.y;
          const horizontalOffset = 216;
          const verticalSpacing = 120;

          const existingTargets = edges
            .filter((e) => e.source === fromNode.id)
            .map((e) => nodes.find((n) => n.id === e.target))
            .filter((n) => n !== undefined);

          let verticalPosition = sourceNode.position.y;

          if (existingTargets.length > 0) {
            if (draggedUp) {
              const firstSibling = existingTargets[0];
              verticalPosition = firstSibling.position.y - verticalSpacing;
            } else {
              const lastSibling = existingTargets[existingTargets.length - 1];
              verticalPosition = lastSibling.position.y + verticalSpacing;
            }
          }

          const calculatedPosition = snapPositionToGrid({
            x: sourceNode.position.x + horizontalOffset,
            y: verticalPosition,
          });

          setCreateStepContext({
            position: calculatedPosition,
            connection: {
              source: fromNode.id,
              sourceHandle: fromHandle?.id || 'source',
            },
          });
        }
      }
    },
    [screenToFlowPosition, nodes, edges]
  );

  const handleEdgeInsertClick = useCallback(
    (edgeData: {
      id: string;
      source: string;
      target: string;
      sourceHandle: string;
      position: { x: number; y: number };
    }) => {
      setCreateStepContext({
        position: edgeData.position,
        insertionEdge: {
          source: edgeData.source,
          target: edgeData.target,
          sourceHandle: edgeData.sourceHandle,
        },
      });
    },
    []
  );

  const handleEdgeParallelClick = useCallback(
    (edgeData: {
      source: string;
      target: string;
      sourceHandle: string;
      position: { x: number; y: number };
    }) => {
      setCreateStepContext({
        position: edgeData.position,
        parallelBranch: {
          source: edgeData.source,
          target: edgeData.target,
          sourceHandle: edgeData.sourceHandle,
        },
      });
    },
    []
  );

  // Route condition/priority editing on a selected edge. Conditions share the
  // canonical suggestion pipeline, scoped to the container the edge is in.
  const updateEdgeData = useWorkflowStore((state) => state.updateEdgeData);
  const edgeRouteActions = useMemo<EdgeRouteActions>(
    () => ({
      onUpdateRouteData: (edgeId, updates) => updateEdgeData(edgeId, updates),
      onDeleteRoute: (edgeId) =>
        onEdgesChange([{ id: edgeId, type: 'remove' }]),
      stepName: (stepId) => canvasDisplayValue.stepNames.get(stepId) || stepId,
      conditionSuggestionsForEdge: (edge) => {
        const container = nodes.find((n) => n.id === edge.source)?.parentId;
        const scope = resolveContainerScope(nodes as ScopeNode[], container);
        return composeConditionSuggestions({
          previousSteps: [],
          inputSchemaFields: workflow?.inputSchemaFields,
          variables: workflow?.variables,
          isInsideWhileLoop: scope.isInsideWhileLoop,
          isInsideSplit: scope.isInsideSplit,
          isInsideWaitScope: scope.isInsideWaitScope,
          splitItemSchemaFields: splitItemSchemaFieldsFromScope(scope),
        });
      },
    }),
    [
      canvasDisplayValue.stepNames,
      nodes,
      onEdgesChange,
      updateEdgeData,
      workflow?.inputSchemaFields,
      workflow?.variables,
    ]
  );

  // Handle step picker selection - stores pending node for user confirmation
  const handleStepPickerSelect = useCallback(
    (result: StepPickerResult) => {
      if (!createStepContext) return;

      // Its id, its place and what it will be wired to (./pending-step.ts).
      setPendingNewNode(
        planPendingStep({
          picked: result,
          context: createStepContext,
          nodes,
          initialData: form.initialValues,
          intersecting: getIntersectingNodes,
        })
      );
      setCreateStepContext(null);
      setSelectedEdgeId(null);
      setShowStepPicker(false);
    },
    [createStepContext, getIntersectingNodes, nodes, setPendingNewNode]
  );

  const handleCancelCreate = useCallback(() => {
    closeCreateStep();
    setPendingNewNode(null);
    setSelectedNodeId(null);
  }, [closeCreateStep, setPendingNewNode, setSelectedNodeId]);

  const validateNodeEditCandidate = useCallback(
    async (
      nodeId: string,
      data: form.SchemaType,
      pendingNode?: PendingNodeCandidate | null
    ) => {
      const currentState = useWorkflowStore.getState();
      const validation = await validateNodeEditWithRust({
        nodes: currentState.nodes,
        edges: currentState.edges,
        nodeId,
        data,
        workflow,
        pendingNode,
      });

      const validationStore = useValidationStore.getState();
      validationStore.clearMessages('client');
      if (validation.messages.length > 0) {
        validationStore.addMessages(validation.messages);
      }

      if (!validation.canApply) {
        toast.error('Step validation failed', {
          description:
            validation.rustValidation.errors[0] ||
            validation.rustValidation.message,
        });
        return false;
      }

      if (validation.rustValidation.status === 'unavailable') {
        toast.warning('Rust validation unavailable', {
          description: validation.rustValidation.message,
        });
      }

      return true;
    },
    [workflow]
  );

  // Node config dialog handlers
  const handleNodeSave = useCallback(
    async (nodeId: string, submitted: form.SchemaType) => {
      // A staged step id rename is applied here, with the rest of the edit.
      // Form-only fields: the staged rename, and the on-wait JSON error that
      // only exists to block Save (ED-32).
      const { data, renameStepTo } = stepEditOf(submitted);
      const canApply = await validateNodeEditCandidate(
        nodeId,
        data as form.SchemaType
      );
      if (!canApply) return false;

      // The rename, the data and what follows from it (./apply-step-edit.ts).
      const applied = applyStepEdit(nodeId, data, renameStepTo);
      if ('error' in applied) {
        toast.error(applied.error);
        return false;
      }
      memoryDraftRef.current = null;
      closeNodeConfig();
      return true;
    },
    [validateNodeEditCandidate, closeNodeConfig]
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      removeNode(nodeId);
      setSelectedNodeId(null);
      closeNodeConfig();
    },
    [removeNode, setSelectedNodeId, closeNodeConfig]
  );

  // Pending new node handlers
  const handlePendingNodeSave = useCallback(
    async (nodeId: string, submitted: form.SchemaType) => {
      if (!pendingNewNode || pendingNewNode.id !== nodeId) return false;
      // Form-only: an on-wait flow chosen before the step existed (ED-10).
      const { addOnWaitFlow, ...data } = submitted as form.SchemaType & {
        addOnWaitFlow?: boolean;
      };
      delete (data as { onWaitJsonError?: unknown }).onWaitJsonError;

      const canApply = await validateNodeEditCandidate(
        nodeId,
        data,
        pendingNewNode
      );
      if (!canApply) return false;

      let addedId: string | null = nodeId;
      const nodeType = STEP_TYPES[data.stepType] || NODE_TYPES.BasicNode;
      const isConditional = nodeType === NODE_TYPES.ConditionalNode;

      // Handle edge connections based on creation context
      if (pendingNewNode.insertionEdge) {
        // Inserting between existing nodes - insertNodeBetween handles everything
        insertNodeBetween(
          pendingNewNode.insertionEdge.source,
          pendingNewNode.insertionEdge.target,
          pendingNewNode.insertionEdge.sourceHandle,
          { ...data, id: nodeId } as any,
          pendingNewNode.position
        );
        setPendingCenterNodeId(nodeId);
        setSelectedNodeId(nodeId);
      } else {
        // Create the node
        const createdNodeId = addNode(
          { ...data, id: nodeId } as any,
          pendingNewNode.position,
          pendingNewNode.parentId
        );

        addedId = createdNodeId ?? null;
        if (createdNodeId) {
          // The edges its place on the canvas calls for (./pending-step.ts).
          const newEdges = pendingStepEdges(
            pendingNewNode,
            createdNodeId,
            isConditional
          );
          if (newEdges.length === 1) {
            addStoreEdge(newEdges[0].from, newEdges[0].to, newEdges[0].label);
          } else if (newEdges.length > 1) {
            addStoreEdges(newEdges);
          }
          // A pinned entry point would leave the new first step unreachable
          // (E002). In auto mode the entry is re-derived from the edges.
          if (
            pendingNewNode.targetNodeId &&
            !pendingNewNode.sourceNodeId &&
            pendingNewNode.becomesEntryPoint &&
            workflow?.entryPoint
          ) {
            onWorkflowChange?.({ entryPoint: createdNodeId });
          }

          setPendingCenterNodeId(createdNodeId);
          setSelectedNodeId(createdNodeId);
        }
      }

      if (addOnWaitFlow && addedId)
        useWorkflowStore.getState().convertNodeToContainer(addedId);
      setPendingNewNode(null);
      return true;
    },
    [
      pendingNewNode,
      validateNodeEditCandidate,
      addNode,
      addStoreEdge,
      addStoreEdges,
      insertNodeBetween,
      setPendingCenterNodeId,
      setSelectedNodeId,
      setPendingNewNode,
      workflow?.entryPoint,
      onWorkflowChange,
    ]
  );

  const handlePendingNodeCancel = useCallback(() => {
    setPendingNewNode(null);
  }, [setPendingNewNode]);

  const noteIds = useMemo(
    () =>
      new Set(
        layoutedCanvasNodes
          .filter((node) => node.type === NODE_TYPES.NoteNode)
          .map((node) => node.id)
      ),
    [layoutedCanvasNodes]
  );

  const handleNodesChange = useCallback(
    (changes: import('@xyflow/react').NodeChange[]) => {
      for (const change of changes) {
        // Only notes move by hand; steps are always laid out.
        if (
          change.type === 'position' &&
          change.position &&
          noteIds.has(change.id)
        ) {
          const dragged = layoutedCanvasNodes.find((n) => n.id === change.id);
          const width = dragged?.width ?? 240;
          const height = dragged?.height ?? 120;
          const position = change.position;
          setNoteDrag({
            id: change.id,
            position,
            attachTo: findAttachTarget(
              { ...position, width, height },
              stepRects(layoutedCanvasNodes),
              undefined,
              dragged ? noteAnchorStepId(dragged) : null
            ),
          });
        }
      }
      const structuralChanges = changes.filter(
        (change) => change.type !== 'position' && change.type !== 'dimensions'
      );
      if (structuralChanges.length > 0) {
        onNodesChange(structuralChanges);
      }
    },
    [layoutedCanvasNodes, noteIds, onNodesChange, setNoteDrag]
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type !== NODE_TYPES.NoteNode) return;
      setNoteDrag(null);
      // React Flow hands over the dropped node's final position; recompute
      // the attach target from it rather than trusting the last drag state.
      const steps = stepRects(layoutedCanvasNodes);
      const attachTo = findAttachTarget(
        {
          ...node.position,
          width: node.width ?? node.measured?.width ?? 240,
          height: node.height ?? node.measured?.height ?? 120,
        },
        steps,
        undefined,
        noteAnchorStepId(node)
      );
      const placement = placementForDrop(node.position, attachTo, steps);
      placeNote(node.id, placement.position, placement.anchorStepId);
    },
    [layoutedCanvasNodes, placeNote, setNoteDrag]
  );

  return (
    <>
      <div data-workflow-editor-root="" className="relative h-full w-full">
        <NodeConfigProvider value={nodeConfigContextValue}>
          <CanvasDisplayProvider value={canvasDisplayValue}>
            <EdgeContextProvider
              onInsertClick={readOnly ? undefined : handleEdgeInsertClick}
              onParallelClick={readOnly ? undefined : handleEdgeParallelClick}
              routeActions={readOnly ? undefined : edgeRouteActions}
              allEdges={edges}
              edgeRoutes={layoutedCanvasEdgeRoutes}
            >
              <ReactFlow
                ref={ref}
                nodes={nodesWithStartIndicator}
                edges={edgesWithStartIndicator}
                edgeTypes={edgeTypes}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange}
                onNodeDragStop={handleNodeDragStop}
                onEdgesChange={onEdgesChange}
                onConnect={readOnly ? undefined : onConnect}
                onConnectEnd={readOnly ? undefined : onConnectEnd}
                isValidConnection={readOnly ? undefined : isValidConnection}
                proOptions={{ hideAttribution: true }}
                minZoom={CANVAS_MIN_ZOOM}
                maxZoom={2}
                // Double-click opens a step's editor. React Flow's zoom-on-
                // double-click (d3-zoom) stops the event at the pane, and with
                // nodes not draggable they lack the class that exempts them,
                // so onNodeDoubleClick never fired.
                zoomOnDoubleClick={false}
                defaultEdgeOptions={{ zIndex: CANVAS_Z.edge }}
                onNodeDoubleClick={(_event, node) => {
                  // Don't open dialog for special nodes
                  if (
                    node.type === NODE_TYPES.CreateNode ||
                    node.type === NODE_TYPES.NoteNode ||
                    node.type === NODE_TYPES.StartIndicatorNode
                  ) {
                    return;
                  }
                  // A new step's panel is open: finish or cancel it first.
                  // Opening another step's editor beside it showed two
                  // config panels (ED-1).
                  if (pendingNewNode) return;
                  // Open dialog for editing on double-click
                  if (workflow && !readOnly) {
                    editNode(node.id);
                  }
                }}
                onNodeClick={(event, node) => {
                  // Don't select special nodes
                  if (
                    node.type === NODE_TYPES.CreateNode ||
                    node.type === NODE_TYPES.NoteNode ||
                    node.type === NODE_TYPES.StartIndicatorNode
                  ) {
                    setSelectedNodeId(null);
                    setSelectedEdgeId(null);
                    return;
                  }
                  // Don't select if clicking on a button
                  const target = event.target as HTMLElement;
                  if (target.closest('button')) {
                    return;
                  }
                  // In debug inspect mode, allow selecting executed nodes only
                  if (debugInspectMode) {
                    const nodeStatus = useExecutionStore
                      .getState()
                      .nodeExecutionStatus.get(node.id);
                    if (nodeStatus) {
                      setSelectedNodeId(node.id);
                      setSelectedEdgeId(null);
                    }
                    return;
                  }
                  // Select node on single click (for moving, keyboard delete, etc.)
                  if (workflow && !readOnly) {
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                    // With a step's editor already open, a click moves it to
                    // the clicked step: reading through steps should not
                    // need a close and a double-click per step. With unsaved
                    // edits it asks first (see editNode).
                    if (editingNodeId && editingNodeId !== node.id) {
                      openNodeConfig(node.id);
                    }
                  }
                }}
                onEdgeClick={(_event, edge) => {
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                }}
                onPaneClick={() => {
                  const { selectedNodeId: currentSelectedNodeId } =
                    useWorkflowStore.getState();
                  if (currentSelectedNodeId) {
                    setSelectedNodeId(null);
                  }
                  if (selectedEdgeId) {
                    setSelectedEdgeId(null);
                  }
                }}
                snapToGrid={true}
                snapGrid={[SNAP_GRID_SIZE, SNAP_GRID_SIZE]}
                elevateEdgesOnSelect={true}
                edgesReconnectable={false}
                disableKeyboardA11y={true}
                elementsSelectable={!readOnly || debugInspectMode}
                nodesDraggable={false}
                nodesConnectable={!readOnly}
                nodesFocusable={!readOnly}
                edgesFocusable={!readOnly}
              >
                <Controls fitViewOptions={CANVAS_FIT_VIEW_OPTIONS} />
                <Background
                  gap={SNAP_GRID_SIZE}
                  size={1}
                  color={isDark ? '#262626' : undefined}
                />
              </ReactFlow>
            </EdgeContextProvider>
          </CanvasDisplayProvider>
        </NodeConfigProvider>
      </div>

      {/* Step Picker Modal */}
      <NodeFormProvider
        isAddingBefore={nodes.length === 0}
        parentNodeId={
          createStepContext?.connection?.source ||
          createStepContext?.insertionEdge?.source ||
          createStepContext?.parallelBranch?.source
        }
        createContainerId={createStepContext?.parentId ?? null}
      >
        <StepPickerModal
          open={showStepPicker}
          onOpenChange={(open) => {
            if (!open) {
              handleCancelCreate();
            }
          }}
          onSelect={handleStepPickerSelect}
          allowFinish={
            !createStepContext?.insertionEdge &&
            !createStepContext?.parallelBranch
          }
          closeOnSelect={false}
        />
      </NodeFormProvider>

      {/* Docked step inspector - for editing existing nodes */}
      {editingNodeData && workflow && (
        <NodeConfigPanel
          open={!!editingNodeId}
          onOpenChange={(open) => {
            if (open) return;
            // Closed without Save (a Save clears the draft first).
            const draft = memoryDraftRef.current;
            memoryDraftRef.current = null;
            if (draft && draft.agentId === editingNodeId) draft.revert();
            closeNodeConfig();
          }}
          nodeId={editingNodeData.id}
          parentNodeId={editingNodeData.parentId}
          nodeData={editingNodeData.data}
          originalNodeData={editingNodeData.originalData}
          outputSchemaFields={workflow.outputSchemaFields}
          inputSchemaFields={workflow.inputSchemaFields}
          stateSchemaFields={workflow.stateSchemaFields}
          variables={workflow.variables}
          onSave={handleNodeSave}
          onDelete={handleNodeDelete}
          onDirtyChange={handleEditorDirtyChange}
        />
      )}

      <DiscardStepChangesDialog
        open={switchTargetId !== null}
        onKeepEditing={cancelSwitch}
        onDiscard={confirmSwitch}
      />

      {/* Docked step inspector - for creating new nodes */}
      {pendingNewNode && workflow && (
        <NodeConfigPanel
          open={!!pendingNewNode}
          onOpenChange={(open) => {
            if (!open) handlePendingNodeCancel();
          }}
          nodeId={pendingNewNode.id}
          nodeData={pendingNewNode.data as unknown as form.SchemaType}
          originalNodeData={pendingNewNode.data as unknown as form.SchemaType}
          outputSchemaFields={workflow.outputSchemaFields}
          inputSchemaFields={workflow.inputSchemaFields}
          stateSchemaFields={workflow.stateSchemaFields}
          variables={workflow.variables}
          onSave={handlePendingNodeSave}
          isCreate
          parentNodeId={
            pendingNewNode.sourceNodeId || pendingNewNode.insertionEdge?.source
          }
          createContainerId={pendingNewNode.parentId ?? null}
        />
      )}
    </>
  );
}

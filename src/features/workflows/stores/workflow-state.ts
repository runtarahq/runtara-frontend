import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import type {
  ExecutionGraphDto,
  ExecutionGraphStepDto,
} from '@/features/workflows/types/execution-graph';
import type { ValidationError } from '@/shared/hooks/api';

export interface HistoryEntry {
  executionGraph: ExecutionGraphDto | null;
  nodes: Node[];
  edges: Edge[];
}

export interface WorkflowState {
  // Core workflow data (backend format)
  executionGraph: ExecutionGraphDto | null;

  // React Flow visual representation
  nodes: Node[];
  edges: Edge[];

  // Metadata
  isDirty: boolean;
  // True only for structural changes (not position/layout-only); used to block execution
  isStructurallyDirty: boolean;
  // Goes up on every edit, so a save can tell whether more came after it.
  dirtyRevision: number;
  selectedNodes: string[];
  selectedEdges: string[];

  // Staged node IDs (nodes with unsaved changes in sidebar)
  stagedNodeIds: Set<string>;

  // Selected node ID for sidebar editing (shared across components)
  selectedNodeId: string | null;

  // Node ID that should be centered in viewport (for newly created nodes)
  pendingCenterNodeId: string | null;

  // Validation errors from last save attempt (for highlighting steps with issues)
  validationErrors: ValidationError[];

  // Step IDs that have validation errors (derived from validationErrors for quick lookup)
  stepsWithErrors: Set<string>;

  // Pending new node (for deferred creation until user confirms in dialog)
  pendingNewNode: {
    id: string;
    data: Partial<ExecutionGraphStepDto>;
    position: { x: number; y: number };
    parentId?: string;
    sourceNodeId?: string; // Node to connect FROM (new node is target)
    targetNodeId?: string; // Node to connect TO (new node is source)
    sourceHandle?: string;
    becomesEntryPoint?: boolean; // Inserted before the first step, from Start
    insertionEdge?: {
      source: string;
      target: string;
      sourceHandle: string;
    };
  } | null;

  // Resize tracking - stores original position/size when resize starts
  resizeTracking: Record<
    string,
    {
      originalPosition: { x: number; y: number };
      originalWidth: number;
      originalHeight: number;
      downstreamNodeOriginalPositions: Record<string, { x: number; y: number }>;
      resizeHandle?: {
        isLeft: boolean;
        isRight: boolean;
        isTop: boolean;
        isBottom: boolean;
      };
    }
  >;

  // Last successful step-id rename, so views holding step ids in local state
  // (config dialog, staged changes) can re-point themselves. A new object is
  // set on every successful rename.
  lastStepRename: { oldId: string; newId: string } | null;

  // History management
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;

  // Actions - State Management
  setExecutionGraph: (graph: ExecutionGraphDto) => void;
  resetState: () => void;
  /** With `savedRevision`, clears only if nothing was edited since then. */
  clearDirtyFlag: (savedRevision?: number) => void;
  setStagedNodeIds: (ids: Set<string>) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setPendingCenterNodeId: (nodeId: string | null) => void;
  setPendingNewNode: (node: WorkflowState['pendingNewNode']) => void;

  // Actions - Node Config Dialog
  requestEditNodeId: string | null;
  setRequestEditNodeId: (nodeId: string | null) => void;

  // Actions - Validation Errors
  setValidationErrors: (errors: ValidationError[]) => void;
  clearValidationErrors: () => void;
  getFirstErrorStepId: () => string | null;

  // Actions - Node Operations
  addNode: (
    step: Partial<ExecutionGraphStepDto>,
    position: { x: number; y: number },
    parentId?: string
  ) => string;
  updateNode: (nodeId: string, updates: Partial<ExecutionGraphStepDto>) => void;
  /**
   * Switch a node to the container node type (WaitForSignal "Add on-wait
   * flow"): children added with this node as parentId then form the nested
   * onWait ExecutionGraph on save. No-op if already a container.
   */
  convertNodeToContainer: (nodeId: string) => void;
  removeNode: (nodeId: string) => void;
  /**
   * Atomically rename a step id: renames the node, re-points edges and child
   * parentIds, and rewrites every `steps.<oldId>` / `steps['<oldId>']`
   * reference across all node and edge data. Returns an error string (and
   * performs no mutation) for duplicate/invalid/same-id renames; returns null
   * on success.
   */
  renameStep: (oldId: string, newId: string) => string | null;

  // Actions - Note Operations
  /**
   * Add a note. With `anchorStepId`, `position` is an offset from that step's
   * laid-out position and the note moves with the step; otherwise it is
   * absolute. `autoEdit` opens the new note straight into its editor.
   */
  addNote: (
    position: { x: number; y: number },
    content?: string,
    options?: { anchorStepId?: string | null; autoEdit?: boolean }
  ) => string;
  /**
   * Edit a note's text or size. Marks the workflow changed — the note card
   * used syncFromReactFlow, which is for loading and clears the dirty flag,
   * so a note edit alone left nothing to save.
   */
  updateNote: (
    noteId: string,
    patch: { content?: string; width?: number; height?: number },
    /** false while a resize is in progress, so undo gets one entry */
    recordHistory?: boolean
  ) => void;
  /** Record where a dragged note was dropped, and what it is attached to. */
  placeNote: (
    noteId: string,
    position: { x: number; y: number },
    anchorStepId: string | null
  ) => void;

  // Actions - Edge Operations
  addEdge: (from: string, to: string, label?: string) => void;
  addEdges: (
    edges: Array<{ from: string; to: string; label?: string }>
  ) => void;
  updateEdgeData: (edgeId: string, updates: Record<string, unknown>) => void;
  removeEdge: (from: string, to: string, label?: string) => void;
  insertNodeBetween: (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle: string,
    newStepData: Partial<ExecutionGraphStepDto>,
    position: { x: number; y: number }
  ) => void;

  // Actions - React Flow Integration
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;

  // Actions - Selection
  setSelectedNodes: (nodeIds: string[]) => void;
  setSelectedEdges: (edgeIds: string[]) => void;

  // Actions - Synchronization
  syncFromReactFlow: (nodes: Node[], edges: Edge[]) => void;
  getReactFlowElements: () => { nodes: Node[]; edges: Edge[] };

  // Actions - History
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;

  // Actions - Layout
  applyAutoLayout: () => void;

  // Computed
  canUndo: () => boolean;
  canRedo: () => boolean;
}

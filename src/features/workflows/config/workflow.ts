import { NODE_TYPES } from './node-types';
import { STEP_TYPE_CATALOG } from '@/features/workflows/step-types/catalog';

export { NODE_TYPES, type NodeTypeId } from './node-types';

/**
 * Canvas node type by step type name, as code that holds a bare string looks
 * it up: a DSL step type, the display name the server gives it ("AI Agent"),
 * or one of the two names that are no DSL step. What each DSL step type is
 * drawn as is said once, in the step-type catalog.
 */
export const STEP_TYPES: Record<string, string> = {
  // The placeholder a new step is picked from.
  Create: NODE_TYPES.CreateNode,
  // Legacy: graphs saved before the entry point named the first real step.
  Start: NODE_TYPES.BasicNode,
  ...Object.fromEntries(
    Object.entries(STEP_TYPE_CATALOG).flatMap(([stepType, traits]) => [
      [stepType, traits.nodeType],
      ...(traits.displayName ? [[traits.displayName, traits.nodeType]] : []),
    ])
  ),
};

// All node sizes must be multiples of 12px grid for proper alignment, and
// heights must be odd multiples of 12 (36, 60, 84, ...) so every node's
// vertical center lands on the same grid phase — see
// snapContainerHeightToGrid. A height that breaks this is silently snapped by
// the layout and the card no longer matches its handles and edges.
// These are the compact sizes; the canvas computes the rendered size per node
// in CustomNodes/node-size.ts.
export const NODE_TYPE_SIZES: Record<
  string,
  { width: number; height: number }
> = {
  [NODE_TYPES.CreateNode]: { width: 216, height: 60 },
  [NODE_TYPES.BasicNode]: { width: 216, height: 60 },
  [NODE_TYPES.ConditionalNode]: { width: 216, height: 60 },
  [NODE_TYPES.SwitchNode]: { width: 216, height: 60 }, // Base size, dynamically adjusted based on cases
  [NODE_TYPES.AiAgentNode]: { width: 252, height: 132 }, // Card layout, dynamically adjusted based on tools/memory
  [NODE_TYPES.ContainerNode]: { width: 168, height: 132 },
  [NODE_TYPES.NoteNode]: { width: 192, height: 96 },
  [NODE_TYPES.StartIndicatorNode]: { width: 72, height: 36 },
};

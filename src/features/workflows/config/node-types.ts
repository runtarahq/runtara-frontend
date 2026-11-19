// Literal key/value types (as const) so a typo'd key is a compile error,
// not a silent `undefined` registration.
export const NODE_TYPES = {
  CreateNode: 'CREATE_NODE',
  BasicNode: 'BASIC_NODE',
  ConditionalNode: 'CONDITIONAL_NODE',
  SwitchNode: 'SWITCH_NODE',
  ContainerNode: 'CONTAINER_NODE',
  AiAgentNode: 'AI_AGENT_NODE',
  NoteNode: 'NOTE_NODE',
  StartIndicatorNode: 'START_INDICATOR_NODE',
} as const;

export type NodeTypeId = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

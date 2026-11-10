import type { Node } from '@xyflow/react';

type MappingItem = {
  type: string;
  value?: unknown;
  valueType?: string;
  typeHint?: string;
};

/**
 * The nodes with an AI Agent's memory conversation id copied onto its memory
 * provider step, or `null` when nothing changes. Applied when the agent's
 * edit is saved: done from the form as it was typed, the provider changed
 * before Save, and Discard did not take it back (ED-33).
 */
export function withMemoryConversation(
  nodes: Node[],
  agentMapping: MappingItem[] | undefined
): Node[] | null {
  const mapping = agentMapping ?? [];
  const conversation = mapping.find(
    (item) => item.type === 'memoryConversationId'
  );
  const provider = mapping.find((item) => item.type === 'memoryProviderStepId');
  if (!conversation || !provider?.value) return null;

  const providerNode = nodes.find((n) => n.id === provider.value);
  if (!providerNode) return null;

  const providerMapping: MappingItem[] = [
    ...(((providerNode.data as { inputMapping?: MappingItem[] }).inputMapping ??
      []) as MappingItem[]),
  ];
  const index = providerMapping.findIndex(
    (item) => item.type === 'conversation_id'
  );
  const value = conversation.value;
  const valueType = conversation.valueType || 'reference';
  if (index >= 0) {
    const current = providerMapping[index];
    if (current.value === value && current.valueType === valueType) return null;
    providerMapping[index] = { ...current, value, valueType };
  } else {
    providerMapping.push({
      type: 'conversation_id',
      value,
      valueType,
      typeHint: 'string',
    });
  }
  return nodes.map((n) =>
    n.id === providerNode.id
      ? { ...n, data: { ...n.data, inputMapping: providerMapping } }
      : n
  );
}

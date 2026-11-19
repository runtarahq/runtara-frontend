import type { Node } from '@xyflow/react';

// An AI Agent's memory is kept by a provider: a step of its own, hidden from
// the canvas and reached from the agent by a `memory` edge. The agent's form
// is where it is configured, so what the form holds for the provider is
// copied onto the provider step when the agent's edit is saved.

type MappingItem = {
  type: string;
  value?: unknown;
  valueType?: string;
  typeHint?: string;
};

/**
 * The inputs a new provider step starts with. The agent fills them at run
 * time, but the validator wants them mapped. Only the ones its capability
 * has: `messages` is an input of saving, not of loading. Without the
 * capability's inputs to go by, both are given, as before.
 */
export function memoryProviderInputs(
  capabilityInputs?: readonly string[]
): MappingItem[] {
  const inputs: MappingItem[] = [
    {
      type: 'conversation_id',
      value: '',
      valueType: 'reference',
      typeHint: 'string',
    },
    { type: 'messages', value: '', valueType: 'reference', typeHint: 'json' },
  ];
  return capabilityInputs
    ? inputs.filter((input) => capabilityInputs.includes(input.type))
    : inputs;
}

/**
 * The nodes with what an AI Agent's form holds for its memory provider
 * copied onto the provider step: the conversation id, and the connection the
 * provider keeps the memory in. `null` when nothing changes.
 *
 * Applied when the agent's edit is saved, and to the graph that edit is
 * validated as. Done from the form as it was typed, the provider changed
 * before Save, and Discard did not take it back (ED-33).
 */
export function withMemorySettings(
  nodes: Node[],
  agentMapping: MappingItem[] | undefined
): Node[] | null {
  const mapping = agentMapping ?? [];
  const provider = mapping.find((item) => item.type === 'memoryProviderStepId');
  if (!provider?.value) return null;
  const providerNode = nodes.find((n) => n.id === provider.value);
  if (!providerNode) return null;

  const data = providerNode.data as {
    inputMapping?: MappingItem[];
    connectionId?: string;
  };
  let nextData: typeof data | null = null;

  const conversation = mapping.find(
    (item) => item.type === 'memoryConversationId'
  );
  if (conversation) {
    const providerMapping: MappingItem[] = [...(data.inputMapping ?? [])];
    const index = providerMapping.findIndex(
      (item) => item.type === 'conversation_id'
    );
    const value = conversation.value;
    const valueType = conversation.valueType || 'reference';
    const current = index >= 0 ? providerMapping[index] : undefined;
    if (!current) {
      providerMapping.push({
        type: 'conversation_id',
        value,
        valueType,
        typeHint: 'string',
      });
      nextData = { ...data, inputMapping: providerMapping };
    } else if (current.value !== value || current.valueType !== valueType) {
      providerMapping[index] = { ...current, value, valueType };
      nextData = { ...data, inputMapping: providerMapping };
    }
  }

  // Only when the form has chosen one: an agent opened and saved untouched
  // leaves the provider's connection as it is.
  const connection = mapping.find((item) => item.type === 'memoryConnectionId');
  if (connection) {
    const connectionId = String(connection.value ?? '');
    if ((data.connectionId ?? '') !== connectionId) {
      nextData = { ...(nextData ?? data), connectionId };
    }
  }

  if (!nextData) return null;
  const changed = nextData;
  return nodes.map((n) =>
    n.id === providerNode.id ? { ...n, data: { ...n.data, ...changed } } : n
  );
}

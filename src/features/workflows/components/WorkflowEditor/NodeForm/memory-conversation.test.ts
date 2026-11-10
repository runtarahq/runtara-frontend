import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { withMemoryConversation } from './memory-conversation';

const provider = (value: string): Node => ({
  id: 'mem',
  position: { x: 0, y: 0 },
  data: {
    inputMapping: [{ type: 'conversation_id', value, valueType: 'immediate' }],
  },
});

describe('withMemoryConversation (ED-33)', () => {
  const agent = (value: string) => [
    { type: 'memoryProviderStepId', value: 'mem' },
    { type: 'memoryConversationId', value, valueType: 'immediate' },
  ];

  it("copies the agent's conversation id onto its provider", () => {
    const next = withMemoryConversation([provider('old')], agent('new'));
    expect(
      (next![0].data as { inputMapping: { value: string }[] }).inputMapping[0]
        .value
    ).toBe('new');
  });

  it('changes nothing when they already agree', () => {
    expect(
      withMemoryConversation([provider('same')], agent('same'))
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { memoryProviderInputs, withMemorySettings } from './memory-provider';

const provider = (value: string): Node => ({
  id: 'mem',
  position: { x: 0, y: 0 },
  data: {
    inputMapping: [{ type: 'conversation_id', value, valueType: 'immediate' }],
  },
});

describe('withMemorySettings (ED-33)', () => {
  const agent = (value: string) => [
    { type: 'memoryProviderStepId', value: 'mem' },
    { type: 'memoryConversationId', value, valueType: 'immediate' },
  ];

  it("copies the agent's conversation id onto its provider", () => {
    const next = withMemorySettings([provider('old')], agent('new'));
    expect(
      (next![0].data as { inputMapping: { value: string }[] }).inputMapping[0]
        .value
    ).toBe('new');
  });

  it('changes nothing when they already agree', () => {
    expect(withMemorySettings([provider('same')], agent('same'))).toBeNull();
  });
});

describe('withMemorySettings: the provider’s connection', () => {
  const agent = (connection?: string) => [
    { type: 'memoryProviderStepId', value: 'mem' },
    ...(connection === undefined
      ? []
      : [{ type: 'memoryConnectionId', value: connection }]),
  ];
  const connectionOf = (nodes: Node[] | null) =>
    (nodes?.[0].data as { connectionId?: string } | undefined)?.connectionId;

  it('gives the provider the connection chosen in the agent’s form', () => {
    expect(
      connectionOf(withMemorySettings([provider('x')], agent('db-1')))
    ).toBe('db-1');
  });

  it('leaves the provider’s connection alone when the form chose none', () => {
    const withConnection: Node = {
      ...provider('x'),
      data: { ...provider('x').data, connectionId: 'db-1' },
    };

    expect(withMemorySettings([withConnection], agent())).toBeNull();
    expect(withMemorySettings([withConnection], agent('db-1'))).toBeNull();
  });

  it('copies the conversation id and the connection together', () => {
    const next = withMemorySettings(
      [provider('old')],
      [
        ...agent('db-2'),
        { type: 'memoryConversationId', value: 'new', valueType: 'immediate' },
      ]
    );

    expect(connectionOf(next)).toBe('db-2');
    expect(
      (next![0].data as { inputMapping: { value: string }[] }).inputMapping[0]
        .value
    ).toBe('new');
  });

  it('does nothing for an agent with no memory provider', () => {
    expect(
      withMemorySettings(
        [provider('x')],
        [{ type: 'memoryConnectionId', value: 'db' }]
      )
    ).toBeNull();
  });
});

describe('memoryProviderInputs', () => {
  const names = (inputs?: string[]) =>
    memoryProviderInputs(inputs).map((input) => input.type);

  it('maps only the inputs the provider’s capability has', () => {
    // Loading has no `messages`: mapping one was an error nothing could fix.
    expect(names(['conversation_id', 'limit'])).toEqual(['conversation_id']);
    expect(names(['conversation_id', 'messages'])).toEqual([
      'conversation_id',
      'messages',
    ]);
  });

  it('maps both when the capability’s inputs are not known', () => {
    expect(names()).toEqual(['conversation_id', 'messages']);
  });
});

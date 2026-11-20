import { describe, expect, it } from 'vitest';
import type {
  ConversationEvent,
  ConversationEventKind,
} from '@/generated/RuntaraRuntimeApi';
import { applyEvent, type ConversationLog } from './conversation-log';

function empty(): ConversationLog {
  return {
    messages: [],
    instanceId: null,
    status: 'idle',
    error: null,
    waitingForInput: null,
    pendingInputs: [],
    pendingInputError: null,
  };
}

/** Applies events in order, numbered from 1, each with its turn. */
function read(
  events: (ConversationEventKind & { turn?: string })[],
  log = empty()
): ConversationLog {
  events.forEach((event, at) =>
    applyEvent(log, {
      seq: log.messages.length + at + 1000,
      createdAt: 'now',
      ...event,
    } as ConversationEvent)
  );
  return log;
}

const spoken = (log: ConversationLog) =>
  log.messages
    .filter((m) => m.role !== 'system')
    .map((m) => [m.role, m.content]);

describe('the conversation log', () => {
  it('shows a message from another sender under that sender', () => {
    const log = read([
      { kind: 'message', body: { id: 'mine', text: 'Hello' } },
      {
        kind: 'message',
        body: {
          id: 'slack-1',
          text: 'Hi from Slack',
          sender: { id: 'U1', name: 'Olena' },
        },
      },
      {
        kind: 'message',
        body: { id: 'wf-1', text: 'From a workflow', sender: { id: 'wf' } },
      },
    ]);
    expect(log.messages.map((m) => [m.content, m.sender])).toEqual([
      ['Hello', undefined],
      ['Hi from Slack', 'Olena'],
      ['From a workflow', 'wf'],
    ]);
  });

  it('shows what a message carries where it has no text', () => {
    const log = read([
      { kind: 'message', body: { id: 'a', payload: { message: 'Typed' } } },
      {
        kind: 'message',
        body: { id: 'b', payload: { city: 'Lviv', nights: 2 } },
      },
      { kind: 'message', body: { id: 'c', payload: {} } },
    ]);
    expect(spoken(log)).toEqual([
      ['user', 'Typed'],
      ['user', '{"city":"Lviv","nights":2}'],
    ]);
  });

  it("keeps a reply's format, data and attachments as they are", () => {
    const log = read([
      {
        kind: 'reply',
        body: {
          text: 'Working on it.',
          format: 'plain',
          data: { stage: 1 },
          attachments: [{ name: 'a.pdf', url: 'https://files/a.pdf' }],
        },
      },
      { kind: 'reply', body: { text: 'In *Markdown*.' } },
      { kind: 'reply', body: { data: { only: 'data' } } },
      { kind: 'reply', body: { text: ' ' } },
    ]);
    expect(
      log.messages.map((m) => [m.content, m.format, m.data, m.attachments])
    ).toEqual([
      [
        'Working on it.',
        'plain',
        { stage: 1 },
        [{ name: 'a.pdf', url: 'https://files/a.pdf' }],
      ],
      ['In *Markdown*.', 'markdown', undefined, undefined],
      ['', 'markdown', { only: 'data' }, undefined],
    ]);
  });
});

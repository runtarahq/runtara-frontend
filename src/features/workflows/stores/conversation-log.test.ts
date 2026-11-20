import { describe, expect, it } from 'vitest';
import type {
  ConversationEvent,
  ConversationEventKind,
  ConversationState,
} from '@/generated/RuntaraRuntimeApi';
import {
  applyEvent,
  applyState,
  type ConversationLog,
} from './conversation-log';

function empty(): ConversationLog {
  return {
    messages: [],
    instanceId: null,
    status: 'idle',
    loading: false,
    lastSeq: 0,
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
  events.forEach((event) =>
    applyEvent(log, {
      seq: log.lastSeq + 1,
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
      ['user', 'city: Lviv\nnights: 2'],
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

  it('keeps each answer under its own message when one is sent mid-run', () => {
    const log = read([
      { kind: 'message', turn: 'm1', body: { id: 'm1', text: 'First' } },
      {
        kind: 'run_started',
        turn: 'm1',
        body: { instanceId: 'run-1', messageId: 'm1' },
      },
      // Sent while the first run is busy: logged now, answered later.
      { kind: 'message', turn: 'm2', body: { id: 'm2', text: 'Second' } },
      { kind: 'reply', turn: 'm1', body: { text: 'Answer to first' } },
      {
        kind: 'run_ended',
        turn: 'm1',
        body: { instanceId: 'run-1', status: 'completed' },
      },
      {
        kind: 'run_started',
        turn: 'm2',
        body: { instanceId: 'run-2', messageId: 'm2' },
      },
      { kind: 'reply', turn: 'm2', body: { text: 'Answer to second' } },
    ]);
    expect(spoken(log)).toEqual([
      ['user', 'First'],
      ['assistant', 'Answer to first'],
      ['user', 'Second'],
      ['assistant', 'Answer to second'],
    ]);
    expect(log.messages.map((m) => m.turn)).toEqual([
      'm1',
      'm1',
      'm1',
      'm2',
      'm2',
      'm2',
    ]);
  });

  it('says of a failed message where it is shown, and of a hidden one apart', () => {
    const log = read([
      { kind: 'message', body: { id: 'opening', payload: {} } },
      { kind: 'message', body: { id: 'm', text: 'Hello' } },
      { kind: 'message_failed', body: { messageId: 'm', reason: 'too late' } },
      {
        kind: 'message_failed',
        body: { messageId: 'opening', reason: 'no such workflow' },
      },
    ]);
    expect(
      log.messages.map((m) => [m.role, m.content, m.failure, m.tone])
    ).toEqual([
      ['user', 'Hello', 'too late', undefined],
      ['system', 'no such workflow', undefined, 'error'],
    ]);
  });

  it('shows a failed run as a line, and the conversation goes on', () => {
    const log = read([
      {
        kind: 'run_started',
        body: { instanceId: 'run-1', messageId: 'm' },
      },
      {
        kind: 'run_ended',
        body: { instanceId: 'run-1', status: 'failed', error: 'boom' },
      },
    ]);
    expect(log.messages.at(-1)).toMatchObject({
      role: 'system',
      content: 'Error: boom',
      tone: 'error',
    });
    expect(log.status).toBe('idle');
  });

  it('warns when the reply workflow could not be started', () => {
    const log = read([
      {
        kind: 'reply_route_failed',
        body: { seq: 4, replyWorkflowId: 'wf', reason: 'it was deleted' },
      },
    ]);
    expect(log.messages).toMatchObject([
      {
        role: 'system',
        tone: 'warning',
        content: 'The reply workflow could not be started: it was deleted',
      },
    ]);
  });

  const state = (fields: Partial<ConversationState>): ConversationState => ({
    id: 'id',
    key: 'key',
    workflowId: 'workflow',
    createdAt: 'now',
    updatedAt: 'now',
    lastSeq: 0,
    queued: 0,
    replyEvents: [],
    ...fields,
  });

  it('takes what the chat is doing from the conversation as it stands', () => {
    const log = empty();
    applyState(log, state({ instanceId: 'run-1' }));
    expect([log.status, log.instanceId]).toEqual(['streaming', 'run-1']);
    applyState(
      log,
      state({ instanceId: 'run-1', waitingFor: { requestId: 'r' } })
    );
    expect(log.status).toBe('waiting_for_input');
    applyState(log, state({}));
    expect(log.status).toBe('idle');
  });

  it('leaves a state older than the events it has read alone', () => {
    const log = read([
      { kind: 'run_started', body: { instanceId: 'run-1', messageId: 'm' } },
      { kind: 'run_ended', body: { instanceId: 'run-1', status: 'completed' } },
    ]);
    // Read before the run ended, answered after.
    applyState(log, state({ instanceId: 'run-1', lastSeq: 1 }));
    expect(log.status).toBe('idle');
  });
});

import { describe, expect, it } from 'vitest';
import { conversationKeyOfRun, conversationPath } from './run-conversation';

describe('the conversation of a run', () => {
  it('is the one its input names', () => {
    expect(
      conversationKeyOfRun({
        inputs: { data: { conversation: { key: 'slack:C1', id: 'x' } } },
      })
    ).toBe('slack:C1');
  });

  it('is none for a run nothing of the kind started', () => {
    expect(conversationKeyOfRun({ inputs: { data: { message: 'hi' } } })).toBe(
      null
    );
    expect(conversationKeyOfRun({ inputs: { data: null } })).toBe(null);
    expect(
      conversationKeyOfRun({ inputs: { data: { conversation: {} } } })
    ).toBe(null);
    expect(conversationKeyOfRun(undefined)).toBe(null);
  });

  it('is shown under its encoded key', () => {
    expect(conversationPath('wf', 'console:a b/c')).toBe(
      '/workflows/wf/chat/c/console%3Aa%20b%2Fc'
    );
  });
});

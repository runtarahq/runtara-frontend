import { describe, expect, it } from 'vitest';

import { dropSavedEntries } from './drop-saved-entries';

describe('dropSavedEntries (WF-2)', () => {
  it('drops everything when nothing changed during the save', () => {
    const sent = { description: 'first', name: 'n' };
    expect(dropSavedEntries(sent, sent)).toEqual({});
  });

  it('keeps an entry edited during the save', () => {
    const sent = { description: 'first', name: 'n' };
    const current = { ...sent, description: 'edited during save' };
    expect(dropSavedEntries(current, sent)).toEqual({
      description: 'edited during save',
    });
  });

  it('keeps an entry first staged during the save', () => {
    const sent = { name: 'n' } as Record<string, unknown>;
    const current = { name: 'n', description: 'new' };
    expect(dropSavedEntries(current, sent)).toEqual({ description: 'new' });
  });

  it('compares by identity, so a re-staged equal object stays', () => {
    const vars = [{ name: 'a' }];
    const sent = { variables: vars };
    const current = { variables: [{ name: 'a' }] };
    expect(dropSavedEntries(current, sent)).toBe(current);
  });

  it('returns the same object when nothing was dropped', () => {
    const current: Record<string, number> = { a: 1 };
    expect(dropSavedEntries(current, {})).toBe(current);
  });
});

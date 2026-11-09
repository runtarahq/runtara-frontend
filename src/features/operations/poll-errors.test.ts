import { describe, expect, it } from 'vitest';

import { failedWithNothingToShow, refreshFailed } from './poll-errors';

const loaded = { error: null, data: [] };
const failedFirst = { error: new Error('500'), data: undefined };
const failedPoll = { error: new Error('500'), data: [] };

describe('poll errors (OP-1, OP-2)', () => {
  it('blocks the page when a query failed with nothing to show', () => {
    expect(failedWithNothingToShow(loaded, failedFirst)).toBe(true);
    expect(refreshFailed(loaded, failedFirst)).toBe(false);
  });

  it('keeps the page when a loaded query fails a poll', () => {
    expect(failedWithNothingToShow(loaded, failedPoll)).toBe(false);
    expect(refreshFailed(loaded, failedPoll)).toBe(true);
  });

  it('is quiet when everything loaded', () => {
    expect(failedWithNothingToShow(loaded, loaded)).toBe(false);
    expect(refreshFailed(loaded)).toBe(false);
  });
});

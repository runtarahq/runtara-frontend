import { describe, expect, it } from 'vitest';

import { historyView } from './history-view';

const state = {
  hasData: false,
  isLoading: false,
  isError: false,
  isInitialLoad: true,
};

describe('historyView (HI-1)', () => {
  it('shows the loader while the first load is in progress', () => {
    expect(historyView({ ...state, isLoading: true })).toBe('loader');
  });

  it('shows the error once the first load has failed', () => {
    expect(historyView({ ...state, isError: true })).toBe('error');
  });

  it('shows the content once loaded', () => {
    expect(historyView({ ...state, hasData: true, isInitialLoad: false })).toBe(
      'content'
    );
  });

  it('shows the loader when a later load has no data and no error', () => {
    expect(historyView({ ...state, isInitialLoad: false })).toBe('loader');
  });
});

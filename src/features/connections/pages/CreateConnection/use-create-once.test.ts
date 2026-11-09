import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCreateOnce } from './use-create-once';

describe('useCreateOnce (CN-9)', () => {
  it('lets only the first submit create', () => {
    const { result } = renderHook(() => useCreateOnce());
    expect(result.current.begin()).toBe(true);
    expect(result.current.begin()).toBe(false);
    expect(result.current.begin()).toBe(false);
  });

  it('allows a retry after a create that failed', () => {
    const { result } = renderHook(() => useCreateOnce());
    expect(result.current.begin()).toBe(true);
    result.current.fail();
    expect(result.current.begin()).toBe(true);
    expect(result.current.begin()).toBe(false);
  });
});

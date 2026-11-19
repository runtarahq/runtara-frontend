import { describe, expect, it } from 'vitest';
import { queryClient } from './query-client';

describe('queryClient', () => {
  it('is importable without mounting the app', () => {
    // The entry module renders into #root; this module must not.
    expect(document.getElementById('root')).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });

  it('keeps data fresh for five minutes, retries once, and does not refetch on focus', () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    });
  });
});

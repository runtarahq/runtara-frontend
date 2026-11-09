import { describe, expect, it } from 'vitest';

import { createRowSaveQueue } from './row-save-queue';

describe('createRowSaveQueue (OB-1)', () => {
  it('lets one save per row run at a time', () => {
    const queue = createRowSaveQueue();
    expect(queue.begin('r1')).toBe(true);
    expect(queue.begin('r1')).toBe(false);
    expect(queue.begin('r2')).toBe(true);
  });

  it('reports a flush that waited, once', () => {
    const queue = createRowSaveQueue();
    queue.begin('r1');
    queue.begin('r1');
    queue.begin('r1');
    expect(queue.end('r1')).toBe(true);
    expect(queue.begin('r1')).toBe(true);
    expect(queue.end('r1')).toBe(false);
  });

  it('frees the row when nothing waited', () => {
    const queue = createRowSaveQueue();
    queue.begin('r1');
    expect(queue.end('r1')).toBe(false);
    expect(queue.begin('r1')).toBe(true);
  });
});

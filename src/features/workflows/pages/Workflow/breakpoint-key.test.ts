import { describe, expect, it } from 'vitest';

import { breakpointKey } from './breakpoint-key';

const hit = (id: number) => ({ id, payload: { step_id: 'log' } });

describe('breakpointKey (EX-1, EX-2)', () => {
  it('is the same for the same event of the same run', () => {
    expect(breakpointKey('run-1', hit(1))).toBe(breakpointKey('run-1', hit(1)));
  });

  it('differs for a new run pausing at the same step', () => {
    expect(breakpointKey('run-2', hit(1))).not.toBe(
      breakpointKey('run-1', hit(1))
    );
  });

  it('differs for a loop reaching the same step again', () => {
    expect(breakpointKey('run-1', hit(2))).not.toBe(
      breakpointKey('run-1', hit(1))
    );
  });

  it('falls back to step, scope and time without an event id', () => {
    const a = {
      payload: { step_id: 'log' },
      createdAt: '2026-01-01T00:00:00Z',
    };
    const b = {
      payload: { step_id: 'log' },
      createdAt: '2026-01-01T00:00:05Z',
    };
    expect(breakpointKey('run-1', a)).toBe(breakpointKey('run-1', { ...a }));
    expect(breakpointKey('run-1', a)).not.toBe(breakpointKey('run-1', b));
  });
});

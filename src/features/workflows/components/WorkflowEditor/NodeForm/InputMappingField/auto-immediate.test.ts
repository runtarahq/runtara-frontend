import { describe, expect, it } from 'vitest';
import { parseAutoImmediate } from './auto-immediate';

describe('parseAutoImmediate', () => {
  it('keeps every step of typing a decimal', () => {
    expect(['1', '1.', '1.5'].map(parseAutoImmediate)).toEqual([1, '1.', 1.5]);
  });

  it('converts text that a number reprints the same', () => {
    expect(parseAutoImmediate('-2.25')).toBe(-2.25);
    expect(parseAutoImmediate('0')).toBe(0);
  });

  it('keeps text that a number would reprint differently', () => {
    for (const text of ['007', '1e3', ' 5', '1.50', '.5', 'Infinity']) {
      expect(parseAutoImmediate(text)).toBe(text);
    }
  });

  it('reads booleans', () => {
    expect(parseAutoImmediate('true')).toBe(true);
    expect(parseAutoImmediate('false')).toBe(false);
  });

  it('keeps empty and plain text', () => {
    expect(parseAutoImmediate('')).toBe('');
    expect(parseAutoImmediate('abc')).toBe('abc');
  });
});

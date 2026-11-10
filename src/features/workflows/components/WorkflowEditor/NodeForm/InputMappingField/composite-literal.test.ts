import { describe, expect, it } from 'vitest';

import { compositeToLiteral, literalToComposite } from './composite-literal';

describe('composite ↔ literal (ED-14)', () => {
  const composite = {
    keep: { valueType: 'immediate', value: 'kept' },
    nested: {
      valueType: 'composite',
      value: [
        { valueType: 'immediate', value: 1 },
        { valueType: 'immediate', value: null },
      ],
    },
  } as const;

  it('turns a structure of literals into its JSON literal', () => {
    expect(compositeToLiteral(composite as never)).toEqual({
      keep: 'kept',
      nested: [1, null],
    });
  });

  it('round-trips a literal back to the same structure', () => {
    expect(literalToComposite({ keep: 'kept', nested: [1, null] })).toEqual(
      composite
    );
  });

  it('has no literal for a structure with a reference', () => {
    expect(
      compositeToLiteral({
        ref: { valueType: 'reference', value: 'data.x' },
      })
    ).toBeUndefined();
  });
});

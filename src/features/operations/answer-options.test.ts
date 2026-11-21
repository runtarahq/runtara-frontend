import { describe, expect, it } from 'vitest';
import { isNegativeAnswer, withFieldLabels } from './answer-options';

describe('answer options', () => {
  it('labels the fields a workflow only gave a key, and keeps the labels it gave', () => {
    expect(
      withFieldLabels({
        decision: { type: 'string', enum: ['approve', 'reject'] },
        refund_reason: { type: 'string' },
        note: { type: 'string', label: 'Note for the customer' },
      })
    ).toEqual({
      decision: {
        type: 'string',
        enum: ['approve', 'reject'],
        label: 'Decision',
      },
      refund_reason: { type: 'string', label: 'Refund reason' },
      note: { type: 'string', label: 'Note for the customer' },
    });
  });
  it('leaves a JSON Schema and a missing schema as they are', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(withFieldLabels(schema)).toBe(schema);
    expect(withFieldLabels(null)).toBeNull();
  });
  it('tells the choice that turns a request down from the others', () => {
    expect(['reject', 'Decline', 'no', false].every(isNegativeAnswer)).toBe(
      true
    );
    expect(['approve', 'notify', true].some(isNegativeAnswer)).toBe(false);
  });
});

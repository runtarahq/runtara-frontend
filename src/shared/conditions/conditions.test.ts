import { describe, expect, it } from 'vitest';

import {
  getArgumentDisplayValue,
  getArgumentImmediateType,
  getArgumentValueType,
  isConditionArgument,
} from './arguments';
import { formatReferenceForDisplay, renderConditionReadable } from './readable';
import {
  filterSuggestions,
  groupSuggestions,
  type ConditionSuggestion,
} from './suggestions';
import type { Condition, ConditionArgument } from './types';

const reference = (value: string): ConditionArgument =>
  ({ valueType: 'reference', value }) as ConditionArgument;
const immediate = (value: unknown, immediateType?: string): ConditionArgument =>
  ({ valueType: 'immediate', value, immediateType }) as ConditionArgument;

const nested = { op: 'EQ', arguments: [] } as unknown as Condition;

const suggestions: ConditionSuggestion[] = [
  {
    label: 'total',
    value: "steps['abc12345-0000'].outputs.total",
    group: 'Step Outputs',
    stepName: 'Fetch order',
    stepId: 'abc12345-0000',
    description: 'Order total',
  },
  { label: 'customerId', value: 'data.customerId', group: 'Workflow Inputs' },
  { label: 'item', value: 'item', group: 'Current Item' },
  { label: 'region', value: 'env.region', group: 'Environment' },
];

describe('condition arguments', () => {
  it('tells a typed argument from a nested condition and from text', () => {
    expect(isConditionArgument(reference('data.a'))).toBe(true);
    expect(isConditionArgument({ op: 'EQ', arguments: [] })).toBe(false);
    expect(isConditionArgument('data.a')).toBe(false);
    expect(isConditionArgument(null)).toBe(false);

    expect(getArgumentValueType('plain')).toBe('immediate');
    expect(getArgumentValueType(reference('data.a'))).toBe('reference');
    expect(getArgumentValueType(nested)).toBe('operation');
  });

  it('shows stored JSON immediates as text', () => {
    expect(getArgumentDisplayValue('plain')).toBe('plain');
    expect(getArgumentDisplayValue(immediate(true))).toBe('true');
    expect(getArgumentDisplayValue(immediate(12))).toBe('12');
    expect(getArgumentDisplayValue(immediate(['a', 'b']))).toBe('a, b');
    expect(getArgumentDisplayValue(immediate(null))).toBe('');
    expect(getArgumentDisplayValue(nested)).toBe('');
  });

  it('keeps a declared immediate type and infers a missing one', () => {
    expect(getArgumentImmediateType(immediate('12', 'string'))).toBe('string');
    expect(getArgumentImmediateType(immediate(12))).toBe('number');
    expect(getArgumentImmediateType(immediate(false))).toBe('boolean');
    expect(getArgumentImmediateType('true')).toBe('boolean');
    expect(getArgumentImmediateType('3.5')).toBe('number');
    expect(getArgumentImmediateType('')).toBe('string');
    expect(getArgumentImmediateType('abc')).toBe('string');
  });
});

describe('renderConditionReadable', () => {
  it('reads a comparison between a reference and a value', () => {
    expect(
      renderConditionReadable({
        op: 'GTE',
        arguments: [reference('data.total'), immediate('100')],
      } as Condition)
    ).toBe('data.total >= 100');
  });

  it('brackets nested conditions inside a conjunction', () => {
    const condition = {
      op: 'AND',
      arguments: [
        { op: 'EQ', arguments: ['data.a', '1'] },
        { op: 'NOT', arguments: [{ op: 'IS_EMPTY', arguments: ['data.b'] }] },
      ],
    } as Condition;

    expect(renderConditionReadable(condition)).toBe(
      '(data.a = 1) AND (NOT (data.b IS EMPTY))'
    );
  });

  it('reads the word operators and the unary ones', () => {
    const read = (op: string, ...args: string[]) =>
      renderConditionReadable({ op, arguments: args } as Condition);

    expect(read('NOT_IN', 'a', 'b')).toBe('a NOT IN b');
    expect(read('STARTS_WITH', 'a', 'b')).toBe('a STARTS WITH b');
    expect(read('IS_DEFINED', 'a')).toBe('a IS DEFINED');
    expect(read('LENGTH', 'a')).toBe('LENGTH(a)');
    expect(read('CUSTOM', 'a', 'b')).toBe('CUSTOM(a, b)');
  });

  it('reads nothing for a condition that is missing or has no operator', () => {
    expect(renderConditionReadable(undefined)).toBe('');
    expect(renderConditionReadable({} as Condition)).toBe('');
    expect(renderConditionReadable({ op: 'NOT' } as Condition)).toBe('NOT');
  });
});

describe('formatReferenceForDisplay', () => {
  it('names a reference the way the picker offered it', () => {
    expect(
      formatReferenceForDisplay(
        "steps['abc12345-0000'].outputs.total",
        suggestions
      )
    ).toBe('Fetch order → total');
    expect(formatReferenceForDisplay('data.customerId', suggestions)).toBe(
      'customerId'
    );
  });

  it('names a hand-typed step path by its step, known or not', () => {
    expect(
      formatReferenceForDisplay(
        "steps['abc12345-0000'].outputs.lines.count",
        suggestions
      )
    ).toBe('Fetch order → lines.count');
    expect(
      formatReferenceForDisplay("steps['ffffffff-1111'].hasFailures", [])
    ).toBe('Step ffffffff... → hasFailures');
    expect(formatReferenceForDisplay("steps['ffffffff-1111']", [])).toBe(
      'Step ffffffff... → outputs'
    );
  });

  it('leaves any other path as written', () => {
    expect(formatReferenceForDisplay('data.unknown', suggestions)).toBe(
      'data.unknown'
    );
  });
});

describe('condition suggestions', () => {
  it('filters by label or description, whatever the case', () => {
    expect(filterSuggestions(suggestions, '')).toBe(suggestions);
    expect(
      filterSuggestions(suggestions, 'CUSTOMER').map((s) => s.label)
    ).toEqual(['customerId']);
    expect(filterSuggestions(suggestions, 'order').map((s) => s.label)).toEqual(
      ['total']
    );
    expect(filterSuggestions(suggestions, 'nothing')).toEqual([]);
  });

  it('groups in the preferred order, with unknown groups after', () => {
    const grouped = groupSuggestions(suggestions);
    const filled = [...grouped].filter(([, items]) => items.length > 0);

    expect(filled.map(([group]) => group)).toEqual([
      'Current Item',
      'Workflow Inputs',
      'Step Outputs',
      'Environment',
    ]);
    expect(grouped.get('Variables')).toEqual([]);
  });
});

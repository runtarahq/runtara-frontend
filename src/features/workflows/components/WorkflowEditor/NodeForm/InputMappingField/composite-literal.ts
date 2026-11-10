import type {
  CompositeArrayValue,
  CompositeObjectValue,
  CompositeValue,
} from '@/features/workflows/stores/nodeFormStore';

/**
 * Carrying a value across Build ↔ Value (ED-14).
 *
 * A Build structure whose every leaf is a literal says exactly what a JSON
 * literal says, and the other way round, so a switch between the two can keep
 * the content instead of starting over. A structure with a reference in it has
 * no literal form; those still start over.
 */

type Literal =
  string | number | boolean | null | Literal[] | { [key: string]: Literal };

function entryToLiteral(entry: CompositeValue): Literal | undefined {
  if (entry.valueType === 'immediate') return entry.value;
  if (entry.valueType === 'composite') return compositeToLiteral(entry.value);
  return undefined;
}

/** The JSON literal a Build structure stands for, or undefined if it has none. */
export function compositeToLiteral(
  value: CompositeObjectValue | CompositeArrayValue
): Literal | undefined {
  if (Array.isArray(value)) {
    const items: Literal[] = [];
    for (const entry of value) {
      const item = entryToLiteral(entry);
      if (item === undefined) return undefined;
      items.push(item);
    }
    return items;
  }
  const out: { [key: string]: Literal } = {};
  for (const [key, entry] of Object.entries(value)) {
    const item = entryToLiteral(entry);
    if (item === undefined) return undefined;
    out[key] = item;
  }
  return out;
}

function literalToEntry(value: unknown): CompositeValue {
  if (value !== null && typeof value === 'object') {
    return { valueType: 'composite', value: literalToComposite(value) };
  }
  return {
    valueType: 'immediate',
    value: value as string | number | boolean | null,
  };
}

/** The Build structure for a JSON object or array literal. */
export function literalToComposite(
  value: object
): CompositeObjectValue | CompositeArrayValue {
  if (Array.isArray(value)) return value.map(literalToEntry);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, literalToEntry(item)])
  );
}

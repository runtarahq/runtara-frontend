import { stateLabel } from './state-label';
export function inlineOptions(
  schema: Record<string, unknown> | null | undefined,
  field?: string | null,
  infer = false
): { field: string; values: unknown[] } | null {
  const fields = (schema?.properties ?? schema ?? {}) as Record<
    string,
    { enum?: unknown[] }
  >;
  const name =
    field ??
    (infer
      ? Object.keys(fields).find((k) => Array.isArray(fields[k]?.enum))
      : undefined);
  return name && Array.isArray(fields[name]?.enum)
    ? { field: name, values: fields[name].enum! }
    : null;
}

/** A choice that turns the request down; shown apart from the one that accepts. */
export function isNegativeAnswer(value: unknown): boolean {
  return (
    value === false ||
    /^(reject(ed)?|decline(d)?|deny|denied|cancel(led)?|refuse(d)?|no|false|block(ed)?|stop)\b/i.test(
      String(value)
    )
  );
}

/**
 * An answer schema whose unnamed fields carry a readable label: a field the
 * workflow only gave a key (`decision`) is shown as "Decision", not as its key.
 * Schemas in JSON Schema form (`properties`) are left as they are.
 */
export function withFieldLabels(
  schema: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!schema || 'properties' in schema) return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([name, field]) => [
      name,
      field && typeof field === 'object' && !Array.isArray(field)
        ? 'label' in field || 'title' in field
          ? field
          : { ...field, label: stateLabel(name) }
        : field,
    ])
  );
}

import type { ColumnDefinition, Instance } from '@/generated/RuntaraRuntimeApi';
import type { FormDefinition, FormField } from '@/shared/forms';
import {
  getWritableObjectColumns,
  mapColumnTypeToDataType,
} from '@/features/objects/utils/columns';

// A record of an object type, as a form: what `shared/forms` needs to draw
// and check one, and how its values go back to the API. A JSON column is
// edited as text and parsed when the record is saved.

function fieldFor(column: ColumnDefinition, order: number): FormField {
  const dataType = mapColumnTypeToDataType(column.type);
  const base = {
    label: column.name,
    order,
    // A column with a default is filled in by the database when left empty.
    required: column.nullable === false && column.default == null,
  };

  switch (dataType) {
    case 'integer':
      return { ...base, type: 'integer' };
    case 'decimal': {
      const precision = 'precision' in column ? column.precision : undefined;
      return {
        ...base,
        type: 'number',
        description: `Decimal number with up to ${precision ?? 19} total digits`,
      };
    }
    case 'boolean':
      // Off is a value, so there is nothing to require.
      return { ...base, type: 'boolean', required: false };
    case 'timestamp':
      return {
        ...base,
        type: 'string',
        format: 'datetime',
        description: 'Picked in your time zone, stored in UTC',
      };
    case 'json':
      return {
        ...base,
        type: 'string',
        format: 'textarea',
        placeholder: '{"key": "value"}',
        description: 'JSON',
      };
    case 'enum':
      return {
        ...base,
        type: 'string',
        enum: 'values' in column ? column.values : [],
      };
    default:
      return { ...base, type: 'string', placeholder: `Enter ${column.name}` };
  }
}

/** The form of a record: one field per column a record can set. */
export function instanceFormDefinition(
  columns: ColumnDefinition[] | undefined
): FormDefinition {
  return {
    fields: Object.fromEntries(
      getWritableObjectColumns(columns).map((column, index) => [
        column.name,
        fieldFor(column, index),
      ])
    ),
  };
}

/** A stored property; older records wrap theirs as `{ value }`. */
function storedValue(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value
    : value;
}

/** What the form starts with: the record's values, or each type's empty one. */
export function initialInstanceValues(
  columns: ColumnDefinition[] | undefined,
  record?: Instance
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of getWritableObjectColumns(columns)) {
    const dataType = mapColumnTypeToDataType(column.type);
    const stored = storedValue(record?.properties?.[column.name]);
    const has = stored !== undefined && stored !== null;

    switch (dataType) {
      case 'integer':
      case 'decimal':
        values[column.name] = has ? stored : 0;
        break;
      case 'boolean':
        values[column.name] = has ? stored : false;
        break;
      case 'json':
        values[column.name] = JSON.stringify(has ? stored : {}, null, 2);
        break;
      case 'enum':
        // Unset rather than '', which is not one of the choices.
        if (has && stored !== '') values[column.name] = stored;
        break;
      default:
        values[column.name] = has ? stored : '';
    }
  }
  return values;
}

type InstanceProperties =
  { properties: Record<string, unknown> } | { error: string };

/** The form's values as the properties of a create or update request. */
export function instanceProperties(
  columns: ColumnDefinition[] | undefined,
  values: Record<string, unknown>
): InstanceProperties {
  const properties: Record<string, unknown> = {};
  for (const column of getWritableObjectColumns(columns)) {
    const dataType = mapColumnTypeToDataType(column.type);
    const value = values[column.name];
    const empty = value === undefined || value === null || value === '';

    switch (dataType) {
      case 'integer':
      case 'decimal':
        properties[column.name] = empty ? 0 : Number(value) || 0;
        break;
      case 'boolean':
        properties[column.name] = Boolean(value);
        break;
      case 'json':
        if (empty) {
          properties[column.name] = {};
          break;
        }
        try {
          properties[column.name] = JSON.parse(String(value));
        } catch {
          return { error: `${column.name} is not valid JSON` };
        }
        break;
      case 'timestamp':
      case 'enum':
        // Neither has an empty value: an empty one is no value.
        properties[column.name] = empty ? null : value;
        break;
      default:
        properties[column.name] = empty ? '' : String(value);
    }
  }
  return { properties };
}

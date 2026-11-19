import { describe, expect, it } from 'vitest';

import type { ColumnDefinition, Instance } from '@/generated/RuntaraRuntimeApi';
import {
  initialInstanceValues,
  instanceFormDefinition,
  instanceProperties,
} from './instance-form';

const columns: ColumnDefinition[] = [
  { name: 'title', type: 'string', nullable: false },
  { name: 'slug', type: 'string', nullable: false, default: "'draft'" },
  { name: 'count', type: 'integer' },
  { name: 'price', type: 'decimal', precision: 12 },
  { name: 'active', type: 'boolean', nullable: false },
  { name: 'publishedAt', type: 'timestamp' },
  { name: 'meta', type: 'json' },
  { name: 'status', type: 'enum', values: ['open', 'closed'] },
  { name: 'search', type: 'tsvector', sourceColumn: 'title' },
];

const record = (properties: Record<string, unknown>) =>
  ({ id: 'r1', properties }) as unknown as Instance;

describe('instanceFormDefinition', () => {
  const { fields } = instanceFormDefinition(columns);

  it('has a field for each column a record can set, in column order', () => {
    expect(Object.keys(fields)).toEqual([
      'title',
      'slug',
      'count',
      'price',
      'active',
      'publishedAt',
      'meta',
      'status',
    ]);
    expect(Object.values(fields).map((field) => field.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('gives each column type the control that edits it', () => {
    expect(fields.title).toMatchObject({ type: 'string', label: 'title' });
    expect(fields.count.type).toBe('integer');
    expect(fields.price).toMatchObject({
      type: 'number',
      description: 'Decimal number with up to 12 total digits',
    });
    expect(fields.active.type).toBe('boolean');
    expect(fields.publishedAt).toMatchObject({
      type: 'string',
      format: 'datetime',
    });
    expect(fields.meta).toMatchObject({ type: 'string', format: 'textarea' });
    expect(fields.status.enum).toEqual(['open', 'closed']);
  });

  it('requires what the database would refuse to leave empty', () => {
    expect(fields.title.required).toBe(true);
    // The database fills a default in; off is a value of a boolean.
    expect(fields.slug.required).toBe(false);
    expect(fields.active.required).toBe(false);
    expect(fields.count.required).toBe(false);
  });

  it('is empty for a type with no columns', () => {
    expect(instanceFormDefinition(undefined)).toEqual({ fields: {} });
  });
});

describe('initialInstanceValues', () => {
  it('starts a new record from each type’s empty value', () => {
    expect(initialInstanceValues(columns)).toEqual({
      title: '',
      slug: '',
      count: 0,
      price: 0,
      active: false,
      publishedAt: '',
      meta: '{}',
    });
  });

  it('starts an edit from the record, unwrapping values stored as { value }', () => {
    expect(
      initialInstanceValues(
        columns,
        record({
          title: { value: 'Hello' },
          count: 3,
          active: true,
          publishedAt: '2026-01-02T03:04:05.000Z',
          meta: { a: 1 },
          status: 'closed',
          price: null,
        })
      )
    ).toEqual({
      title: 'Hello',
      slug: '',
      count: 3,
      price: 0,
      active: true,
      publishedAt: '2026-01-02T03:04:05.000Z',
      meta: '{\n  "a": 1\n}',
      status: 'closed',
    });
  });
});

describe('instanceProperties', () => {
  it('sends each value as its column’s type', () => {
    expect(
      instanceProperties(columns, {
        title: 'Hello',
        slug: '',
        count: '4',
        price: 1.5,
        active: 1,
        publishedAt: '2026-01-02T03:04:05.000Z',
        meta: '{"a":[1,2]}',
        status: 'open',
        search: 'ignored',
      })
    ).toEqual({
      properties: {
        title: 'Hello',
        slug: '',
        count: 4,
        price: 1.5,
        active: true,
        publishedAt: '2026-01-02T03:04:05.000Z',
        meta: { a: [1, 2] },
        status: 'open',
      },
    });
  });

  it('sends no value for an empty date or choice, and zero for an empty number', () => {
    const result = instanceProperties(columns, initialInstanceValues(columns));
    expect(result).toEqual({
      properties: {
        title: '',
        slug: '',
        count: 0,
        price: 0,
        active: false,
        publishedAt: null,
        meta: {},
        status: null,
      },
    });
  });

  it('names the column whose JSON does not parse instead of sending it', () => {
    expect(instanceProperties(columns, { meta: '{"a":' })).toEqual({
      error: 'meta is not valid JSON',
    });
  });

  it('round-trips a record that is opened and saved untouched', () => {
    const properties = {
      title: 'Hello',
      slug: 'hello',
      count: 3,
      price: 2.25,
      active: true,
      publishedAt: '2026-01-02T03:04:05.000Z',
      meta: { nested: { a: 1 } },
      status: 'closed',
    };
    expect(
      instanceProperties(
        columns,
        initialInstanceValues(columns, record(properties))
      )
    ).toEqual({ properties });
  });
});

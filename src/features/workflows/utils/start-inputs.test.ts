import { describe, expect, it } from 'vitest';

import type { FormAnalysisResult, FormDefinition } from '@/shared/forms';
import {
  changedInputs,
  initialStartInputs,
  startBlockingIssues,
} from './start-inputs';

const definition: FormDefinition = {
  fields: {
    name: { type: 'string', required: true },
    notes: { type: 'string' },
    count: { type: 'integer', required: true },
    active: { type: 'boolean' },
    tags: { type: 'array', required: true },
    metadata: { type: 'object', required: true },
    labels: { type: 'array', default: ['a'] },
  },
};

const analysis = (
  ...issues: [code: string, field: string, severity?: 'error' | 'warning'][]
): FormAnalysisResult =>
  ({
    success: true,
    valid: issues.length === 0,
    status: issues.length === 0 ? 'valid' : 'invalid',
    fields: {},
    issues: issues.map(([code, field, severity = 'error']) => ({
      code,
      path: `data.${field}`,
      message: `${field} is required`,
      severity,
    })),
    message: '',
    wasmAvailable: true,
  }) as FormAnalysisResult;

describe('initialStartInputs', () => {
  it('leaves a list or an object nobody has touched out, so a required one is missing (SYN-106)', () => {
    const values = initialStartInputs(definition);

    expect(values).not.toHaveProperty('tags');
    expect(values).not.toHaveProperty('metadata');
    expect(values).toMatchObject({ name: '', notes: '', active: false });
  });

  it('keeps a default, a list’s included', () => {
    expect(initialStartInputs(definition).labels).toEqual(['a']);
  });
});

describe('changedInputs', () => {
  it('names what differs, added and removed inputs included', () => {
    expect(
      changedInputs(
        { name: '', count: 1, gone: true },
        { name: 'a', count: 1, tags: [] }
      ).sort()
    ).toEqual(['gone', 'name', 'tags']);
    expect(changedInputs({ name: 'a' }, { name: 'a' })).toEqual([]);
  });
});

describe('startBlockingIssues', () => {
  it('refuses a required text input nobody filled in', () => {
    const issues = startBlockingIssues(
      analysis(['REQUIRED_FORM_FIELD_MISSING', 'name']),
      { name: '' },
      new Set()
    );

    expect(issues).toHaveLength(1);
  });

  it('accepts one the user typed into and emptied: given, as an empty string (SYN-110)', () => {
    const issues = startBlockingIssues(
      analysis(['REQUIRED_FORM_FIELD_MISSING', 'name']),
      { name: '' },
      new Set(['name'])
    );

    expect(issues).toEqual([]);
  });

  it('still refuses a required list that was never given, edited or not', () => {
    const issues = startBlockingIssues(
      analysis(['REQUIRED_FORM_FIELD_MISSING', 'tags']),
      {},
      new Set(['tags'])
    );

    expect(issues).toHaveLength(1);
  });

  it('still refuses any other problem with an edited input, and ignores warnings', () => {
    const issues = startBlockingIssues(
      analysis(
        ['FORM_FIELD_TYPE_MISMATCH', 'name'],
        ['FORM_FIELD_NOT_IN_ENUM', 'notes', 'warning']
      ),
      { name: '' },
      new Set(['name'])
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'FORM_FIELD_TYPE_MISMATCH',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { STEP_TYPE_NAMES } from '@/features/workflows/types/execution-graph';
import {
  STEP_FORM_RULES,
  checkStepForm,
  type StepFormValues,
} from './form-rules';

const issues = (values: StepFormValues) => {
  const found: Array<{ path: string; message: string }> = [];
  checkStepForm(values, (path, message) =>
    found.push({ path: path.join('.'), message })
  );
  return found;
};
const row = (type: string, value: unknown, valueType = 'immediate') => ({
  type,
  value,
  valueType,
});

describe('the step form rules', () => {
  it('have an entry for every DSL step type', () => {
    expect(Object.keys(STEP_FORM_RULES).sort()).toEqual(
      [...STEP_TYPE_NAMES].sort()
    );
  });

  it('check nothing for a name that is no step type', () => {
    expect(issues({ stepType: 'Create' })).toEqual([]);
    expect(issues({ stepType: 'toString' })).toEqual([]);
    expect(issues({})).toEqual([]);
  });

  it('check nothing for a step type with no rule of its own', () => {
    expect(issues({ stepType: 'Agent', inputMapping: [] })).toEqual([]);
  });

  describe('Switch', () => {
    const required = [
      { path: 'inputMapping', message: 'Value to Switch On is required' },
    ];

    it('needs the value it switches on', () => {
      expect(issues({ stepType: 'Switch', inputMapping: [] })).toEqual(
        required
      );
      expect(
        issues({ stepType: 'Switch', inputMapping: [row('value', '  ')] })
      ).toEqual(required);
      expect(
        issues({
          stepType: 'Switch',
          inputMapping: [row('value', {}, 'composite')],
        })
      ).toEqual(required);
      expect(
        issues({
          stepType: 'Switch',
          inputMapping: [row('value', null, 'reference')],
        })
      ).toEqual(required);
    });

    it('accepts a reference, text, and an immediate null', () => {
      for (const value of [
        row('value', 'data.kind', 'reference'),
        row('value', 'a'),
        row('value', null, 'immediate'),
        row('value', { kind: 'a' }, 'composite'),
        row('value', 0),
      ]) {
        expect(issues({ stepType: 'Switch', inputMapping: [value] })).toEqual(
          []
        );
      }
    });
  });

  describe('Split', () => {
    it('needs a name for a variable that has a value, and a value for one that has a name', () => {
      expect(
        issues({
          stepType: 'Split',
          splitVariablesFields: [
            { name: '', value: 'eu', valueType: 'immediate' },
            { name: 'region', value: '', valueType: 'immediate' },
            { name: 'ok', value: 'x', valueType: 'immediate' },
            // A row not started yet is nobody's problem.
            { name: '', value: '', valueType: 'immediate' },
          ],
        })
      ).toEqual([
        {
          path: 'splitVariablesFields.0.name',
          message: 'Variable name is required',
        },
        {
          path: 'splitVariablesFields.1.value',
          message: 'Variable value is required',
        },
      ]);
    });
  });

  describe('Finish', () => {
    it('refuses two outputs of one name, on each of them', () => {
      expect(
        issues({
          stepType: 'Finish',
          inputMapping: [
            row('total', 1),
            row(' total ', 2),
            row('count', 3),
            row('', 4),
          ],
        })
      ).toEqual([
        {
          path: 'inputMapping.0.type',
          message: 'Duplicate output name "total"',
        },
        {
          path: 'inputMapping.1.type',
          message: 'Duplicate output name "total"',
        },
      ]);
    });

    it('accepts outputs with distinct names', () => {
      expect(
        issues({
          stepType: 'Finish',
          inputMapping: [row('total', 1), row('count', 2)],
        })
      ).toEqual([]);
    });
  });
});

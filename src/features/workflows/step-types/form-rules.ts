import type { StepType } from '../types/execution-graph';
import { exactStepTypeTraits } from './catalog';

/**
 * What a step type's form refuses to save, beyond what its fields check on
 * their own. The server would refuse the same, later and less legibly (a raw
 * serde error), or not at all (a duplicate output name is lost silently).
 *
 * One entry per DSL step type, like the other step-type tables; `null` for a
 * step type with nothing to add.
 */

/** A row of the form's input mapping, as far as the rules read it. */
interface MappingRow {
  type?: string;
  value?: unknown;
  valueType?: string;
}

/** What the rules read of the node form's values. */
export interface StepFormValues {
  stepType?: string;
  inputMapping?: MappingRow[];
  splitVariablesFields?: Array<{
    name?: string;
    value?: unknown;
    valueType?: string;
  }>;
}

/** Reports a problem at a path of the form. */
export type ReportFormIssue = (
  path: Array<string | number>,
  message: string
) => void;

type StepFormRule = (values: StepFormValues, report: ReportFormIssue) => void;

/** Whether a mapping holds something: not unset, not blank, not an empty composite. */
function hasMappingValue(value: unknown, valueType: string | undefined) {
  const isEmptyComposite =
    valueType === 'composite' &&
    value !== null &&
    typeof value === 'object' &&
    (Array.isArray(value)
      ? value.length === 0
      : Object.keys(value as object).length === 0);
  return (
    value !== undefined &&
    (value !== null || valueType === 'immediate') &&
    !(typeof value === 'string' && value.trim() === '') &&
    !isEmptyComposite
  );
}

// SwitchConfig.value is mandatory on the backend (a deny_unknown_fields serde
// struct), so an empty value must block the save here.
const switchNeedsItsValue: StepFormRule = (values, report) => {
  const valueRow = (values.inputMapping || []).find(
    (row) => row.type === 'value'
  );
  if (!valueRow || !hasMappingValue(valueRow.value, valueRow.valueType)) {
    report(['inputMapping'], 'Value to Switch On is required');
  }
};

const splitVariablesAreWhole: StepFormRule = (values, report) => {
  (values.splitVariablesFields || []).forEach((variable, index) => {
    const name = (variable.name || '').trim();
    const hasValue = hasMappingValue(variable.value, variable.valueType);
    if (hasValue && !name) {
      report(
        ['splitVariablesFields', index, 'name'],
        'Variable name is required'
      );
    }
    if (name && !hasValue) {
      report(
        ['splitVariablesFields', index, 'value'],
        'Variable value is required'
      );
    }
  });
};

// Finish outputs are saved through Object.fromEntries, which keeps the last
// of two rows with one name and drops the other before the server sees it.
const finishOutputsAreDistinct: StepFormRule = (values, report) => {
  const rows = values.inputMapping || [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = (row.type || '').trim();
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  rows.forEach((row, index) => {
    const name = (row.type || '').trim();
    if (name && (counts.get(name) || 0) > 1) {
      report(
        ['inputMapping', index, 'type'],
        `Duplicate output name "${name}"`
      );
    }
  });
};

export const STEP_FORM_RULES: { [T in StepType]: StepFormRule | null } = {
  Switch: switchNeedsItsValue,
  Split: splitVariablesAreWhole,
  Finish: finishOutputsAreDistinct,
  Agent: null,
  Conditional: null,
  EmbedWorkflow: null,
  While: null,
  Log: null,
  Error: null,
  Filter: null,
  GroupBy: null,
  Delay: null,
  WaitForSignal: null,
  WaitForInstances: null,
  SetState: null,
  GetState: null,
  AiAgent: null,
};

/** Runs the rule of the form's step type, if it has one. */
export function checkStepForm(
  values: StepFormValues,
  report: ReportFormIssue
): void {
  if (!exactStepTypeTraits(values.stepType)) return;
  STEP_FORM_RULES[values.stepType as StepType]?.(values, report);
}

import type {
  FormAnalysisResult,
  FormDefinition,
  FormIssue,
} from '@/shared/forms';
import { initialWorkflowFormValues } from './form-schema-adapter';

// The inputs a workflow is started with, as the Execute dialog holds them.
// They differ from an ordinary form's values in what counts as "not given":
// the server tells a missing input from an empty one, and accepts an empty
// string, an empty list and zero for a required input (SYN-106, SYN-110).

/**
 * What the dialog starts with. A list or an object nobody has touched is not
 * given, rather than given empty: a required one then has to be filled in
 * before the workflow can start.
 */
export function initialStartInputs(
  definition: FormDefinition
): Record<string, unknown> {
  const values = initialWorkflowFormValues(definition);
  for (const [name, field] of Object.entries(definition.fields)) {
    if (
      field.default === undefined &&
      (field.type === 'array' || field.type === 'object')
    ) {
      delete values[name];
    }
  }
  return values;
}

/** The inputs whose value differs between two states of the dialog. */
export function changedInputs(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (name) => before[name] !== after[name]
  );
}

/**
 * The problems that stop a start. The form's validator calls a required text
 * input left blank missing; one the user typed into and then emptied was
 * given, as an empty string, and the server accepts that.
 */
export function startBlockingIssues(
  analysis: FormAnalysisResult,
  values: Record<string, unknown>,
  edited: ReadonlySet<string>
): FormIssue[] {
  return analysis.issues.filter((issue) => {
    if (issue.severity !== 'error') return false;
    const name = issue.path.replace(/^data\./, '');
    const givenEmpty =
      issue.code === 'REQUIRED_FORM_FIELD_MISSING' &&
      values[name] === '' &&
      edited.has(name);
    return !givenEmpty;
  });
}

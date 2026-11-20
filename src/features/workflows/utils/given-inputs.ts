import type { SchemaField } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/SchemaFieldsEditor';

/**
 * What the server puts in a run's input beside what its caller sent. A
 * workflow does not declare these in its input schema, so the editor offers
 * and types them itself. Each is there only for a run started the way its
 * description says.
 */
export const GIVEN_INPUT_FIELDS: SchemaField[] = [
  {
    name: 'headers',
    type: 'object',
    required: false,
    description:
      "The request's headers, when a webhook starts the run: lower-case names, and never authorization or cookie",
  },
];

/** The given fields a workflow's own input schema does not declare: one it
 * declares under the same name is the workflow's to describe. */
export function givenInputFields(
  declared: SchemaField[] | undefined
): SchemaField[] {
  const names = new Set((declared ?? []).map((field) => field.name));
  return GIVEN_INPUT_FIELDS.filter((field) => !names.has(field.name));
}

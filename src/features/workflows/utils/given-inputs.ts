import type { SchemaField } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/SchemaFieldsEditor';

/**
 * What the server puts in a run's input beside what its caller sent. The
 * editor offers and types them itself. Each is there only for a run started
 * the way its description says.
 *
 * The server's validator knows nothing of them: a reference to `data.*` it
 * does not find in the workflow's input schema is refused. So a workflow
 * that refers to one declares it, which `declareGivenInputs` does when the
 * schema is built.
 */
export const GIVEN_INPUT_FIELDS: SchemaField[] = [
  {
    name: 'headers',
    type: 'object',
    required: false,
    description:
      "The request's headers, when a webhook starts the run: lower-case names, and never authorization or cookie",
  },
  {
    name: 'conversation',
    type: 'object',
    required: false,
    description: 'The conversation, when one starts the run',
    properties: [
      {
        name: 'id',
        type: 'string',
        required: false,
        description:
          "The conversation's id: an AI Agent whose memory is mapped to it remembers by conversation",
      },
      {
        name: 'key',
        type: 'string',
        required: false,
        description: "The conversation's key, as its client named it",
      },
      {
        name: 'workflowId',
        type: 'string',
        required: false,
        description: 'The workflow the conversation is with',
      },
      {
        name: 'title',
        type: 'string',
        required: false,
        description: 'What a person calls the conversation',
      },
      {
        name: 'metadata',
        type: 'object',
        required: false,
        description: 'What the client keeps about the conversation',
      },
    ],
  },
];

/** The reference an AI Agent's memory is mapped to, to remember by
 * conversation: one history per conversation, across its runs. */
export const CONVERSATION_ID_REFERENCE = 'data.conversation.id';

/**
 * Whether a workflow being edited can chat: it has a step that waits to be
 * told something, which is what the server looks for (`supportsChat`). It is
 * asked of the steps as they are now, since the server's answer is for the
 * workflow as it was last saved.
 */
export function stepsCanChat(steps: { data?: unknown }[] | undefined): boolean {
  return (steps ?? []).some(
    (step) =>
      (step.data as { stepType?: unknown } | undefined)?.stepType ===
      'WaitForSignal'
  );
}

/** The given fields a workflow's own input schema does not declare: one it
 * declares under the same name is the workflow's to describe. */
export function givenInputFields(
  declared: { name: string }[] | undefined
): SchemaField[] {
  const names = new Set((declared ?? []).map((field) => field.name));
  return GIVEN_INPUT_FIELDS.filter((field) => !names.has(field.name));
}

/** A reference to a given field's own path or anything under it, under
 * either spelling of the workflow's input: `data.x` and
 * `workflow.inputs.data.x`. */
function refersTo(name: string): RegExp {
  return new RegExp(
    `(^|[^\\w.])(workflow\\.inputs\\.)?data\\.${name}(?![\\w-])`
  );
}

/**
 * The workflow's input schema fields, with each given field that a step
 * refers to declared if it is not: optional, and described as the server's.
 * The server refuses a reference to an input the schema does not declare,
 * so without this a workflow that reads `data.conversation.id` or
 * `data.headers` could not be saved. A field the workflow declares itself
 * is left as it is, and nothing is declared that no step refers to.
 */
export function declareGivenInputs<Field extends { name: string }>(
  declared: Field[] | undefined,
  steps: unknown
): (Field | SchemaField)[] {
  const fields: (Field | SchemaField)[] = declared ?? [];
  const missing = givenInputFields(fields);
  if (missing.length === 0) return fields;
  // Every reference is a string somewhere in a step's data.
  const text = JSON.stringify(steps ?? null) ?? '';
  const referred = missing.filter((field) => refersTo(field.name).test(text));
  return referred.length ? [...fields, ...referred] : fields;
}

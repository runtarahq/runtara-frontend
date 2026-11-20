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
  declared: SchemaField[] | undefined
): SchemaField[] {
  const names = new Set((declared ?? []).map((field) => field.name));
  return GIVEN_INPUT_FIELDS.filter((field) => !names.has(field.name));
}

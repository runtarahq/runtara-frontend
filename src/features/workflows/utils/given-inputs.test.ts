import { describe, expect, it } from 'vitest';
import type { SchemaField } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/SchemaFieldsEditor';
import { composeVariableSuggestions } from '@/features/workflows/components/WorkflowEditor/NodeForm/InputMappingValueField/VariableSuggestions';
import { resolveReferenceType } from '@/features/workflows/components/WorkflowEditor/NodeForm/reference-type';
import {
  CONVERSATION_ID_REFERENCE,
  givenInputFields,
  stepsCanChat,
} from './given-inputs';

const declared = (name: string, type: string): SchemaField => ({
  name,
  type,
  required: false,
  description: 'Declared by the workflow',
});

const offered = (inputSchemaFields?: SchemaField[]) =>
  Object.fromEntries(
    composeVariableSuggestions([], inputSchemaFields).map((s) => [s.value, s])
  );

describe('what the server gives a run beside its input', () => {
  it("offers a webhook's headers, and says what is never among them", () => {
    const headers = offered()['workflow.inputs.data.headers'];
    expect(headers).toMatchObject({ group: 'Workflow Inputs', type: 'object' });
    expect(headers.description).toMatch(/never authorization or cookie/);
  });

  it('types a reference to the headers under either spelling', () => {
    expect(resolveReferenceType('data.headers', {})).toBe('object');
    expect(resolveReferenceType('workflow.inputs.data.headers', {})).toBe(
      'object'
    );
    // A header's own type is not known: any name may be sent.
    expect(
      resolveReferenceType('data.headers.x-signature', {})
    ).toBeUndefined();
  });

  it('leaves a field the workflow declares under that name to the workflow', () => {
    const own = [declared('headers', 'string')];
    expect(givenInputFields(own).map((f) => f.name)).not.toContain('headers');
    expect(offered(own)['workflow.inputs.data.headers'].description).toBe(
      'Declared by the workflow'
    );
    expect(
      resolveReferenceType('data.headers', { inputSchemaFields: own })
    ).toBe('string');
  });

  it('is not offered where data is not the workflow input', () => {
    const inSplit = composeVariableSuggestions(
      [],
      undefined,
      undefined,
      false,
      true
    );
    expect(inSplit.some((s) => s.value.endsWith('.headers'))).toBe(false);
    expect(
      resolveReferenceType('data.headers', { insideSplitScope: true })
    ).toBeUndefined();
  });

  it('offers the conversation of a run a conversation started, and its id as a string', () => {
    const all = offered();
    expect(all['workflow.inputs.data.conversation']).toMatchObject({
      type: 'object',
    });
    expect(all['workflow.inputs.data.conversation.id']).toMatchObject({
      label: 'conversation.id',
      type: 'string',
    });
    expect(resolveReferenceType(CONVERSATION_ID_REFERENCE, {})).toBe('string');
    expect(resolveReferenceType('data.conversation.metadata', {})).toBe(
      'object'
    );
  });

  it('takes a workflow with a step that waits to be told something for one that can chat', () => {
    expect(stepsCanChat([{ data: { stepType: 'AiAgent' } }])).toBe(false);
    expect(
      stepsCanChat([
        { data: { stepType: 'AiAgent' } },
        { data: { stepType: 'WaitForSignal' } },
      ])
    ).toBe(true);
    expect(stepsCanChat(undefined)).toBe(false);
  });
});

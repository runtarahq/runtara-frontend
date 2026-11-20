import { describe, expect, it } from 'vitest';
import type { SchemaField } from '@/features/workflows/components/WorkflowEditor/EditorSidebar/SchemaFieldsEditor';
import { composeVariableSuggestions } from '@/features/workflows/components/WorkflowEditor/NodeForm/InputMappingValueField/VariableSuggestions';
import { resolveReferenceType } from '@/features/workflows/components/WorkflowEditor/NodeForm/reference-type';
import { buildSchemaFromFields } from './schema';
import {
  CONVERSATION_ID_REFERENCE,
  declareGivenInputs,
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

  describe('declared where a step refers to it', () => {
    const agent = (reference: string) => [
      {
        stepType: 'AiAgent',
        inputMapping: [
          {
            type: 'memoryConversationId',
            value: reference,
            valueType: 'reference',
          },
        ],
      },
    ];
    const names = (fields: SchemaField[]) => fields.map((f) => f.name);

    it('declares the conversation for a workflow that reads its id', () => {
      const fields = declareGivenInputs([], agent(CONVERSATION_ID_REFERENCE));
      expect(names(fields)).toEqual(['conversation']);
      // Optional, and with the id the reference reads, so the server finds
      // the whole path and no run is refused for lacking it.
      expect(fields[0]).toMatchObject({ type: 'object', required: false });
      expect(names(fields[0].properties ?? [])).toContain('id');
    });

    it('is saved as a schema the server finds the reference in', () => {
      const schema = buildSchemaFromFields(
        declareGivenInputs([], agent(CONVERSATION_ID_REFERENCE))
      );
      // The shape a local 11.0.0 server accepted with no warning.
      expect(schema.conversation).toMatchObject({
        type: 'object',
        required: false,
        properties: { id: { type: 'string', required: false } },
      });
    });

    it('takes either spelling of the workflow input', () => {
      expect(
        names(
          declareGivenInputs([], agent('workflow.inputs.data.conversation.id'))
        )
      ).toEqual(['conversation']);
      expect(
        names(declareGivenInputs([], [{ value: 'data.headers.x-signature' }]))
      ).toEqual(['headers']);
    });

    it("keeps the workflow's own fields, before what is added", () => {
      const own = [declared('message', 'string')];
      expect(
        names(declareGivenInputs(own, agent(CONVERSATION_ID_REFERENCE)))
      ).toEqual(['message', 'conversation']);
    });

    it('declares nothing that no step refers to', () => {
      const own = [declared('message', 'string')];
      expect(declareGivenInputs(own, agent('data.message'))).toBe(own);
      expect(declareGivenInputs(undefined, [])).toEqual([]);
      // Another field whose name only begins the same, and another root.
      expect(
        declareGivenInputs(
          [],
          [
            { value: 'data.conversationId' },
            { value: 'steps.a.outputs.data.headers' },
            { value: 'metadata.conversation' },
          ]
        )
      ).toEqual([]);
    });

    it('leaves a field the workflow declares under that name as it is', () => {
      const own = [declared('conversation', 'string')];
      expect(declareGivenInputs(own, agent(CONVERSATION_ID_REFERENCE))).toBe(
        own
      );
    });
  });
});

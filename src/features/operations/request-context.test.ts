import { describe, expect, it } from 'vitest';
import { contextEntries, contextSummary, contextText } from './request-context';

// The context a tool builder's approval step carries.
const toolSpec = {
  tool_name: 'slugify',
  agent_id: 'text',
  capability_id: 'slugify',
  description:
    'Convert a given text string into a URL-safe slug by trimming whitespace and lowercasing it.',
  fixed_inputs: { '': {} },
  chat_workflow_id: '023afe91-b9c3-4271-a9cc-7724cb975a4b',
};

describe('request context', () => {
  it('lists the context in order, labelled, leaving out what says nothing', () => {
    const entries = contextEntries(toolSpec);
    expect(entries.map((e) => e.key)).toEqual([
      'tool_name',
      'agent_id',
      'capability_id',
      'description',
      'chat_workflow_id',
    ]);
    expect(entries[0].label).toBe('Tool name');
  });

  it('keeps an object with something in it', () => {
    const entries = contextEntries({ fixed_inputs: { code_type: 'alpha2' } });
    expect(entries).toHaveLength(1);
    expect(contextText(entries[0].value)).toBe('{"code_type":"alpha2"}');
  });

  it('is empty for a context that is not an object', () => {
    expect(contextEntries(null)).toEqual([]);
    expect(contextEntries('text')).toEqual([]);
    expect(contextEntries([1, 2])).toEqual([]);
  });

  it('summarises a row with its first short scalar entries', () => {
    expect(contextSummary(toolSpec)).toBe(
      'Tool name: slugify · Agent id: text · Capability id: slugify'
    );
    expect(contextSummary({})).toBe('');
    // An id says nothing to whoever reads the list.
    expect(
      contextSummary({
        agent_id: 'text',
        chat_workflow_id: '023afe91-b9c3-4271-a9cc-7724cb975a4b',
        tool_name: 'slugify',
      })
    ).toBe('Agent id: text · Tool name: slugify');
  });
});

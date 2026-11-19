import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  convertClientErrors,
  convertClientWarnings,
} from './validation-helpers';

const nodes = [
  {
    id: 'group_by',
    position: { x: 0, y: 0 },
    data: { id: 'group_by', stepType: 'GroupBy', name: 'Group By' },
  },
  {
    id: 'unnamed',
    position: { x: 0, y: 0 },
    data: { id: 'unnamed', stepType: 'Log' },
  },
] as unknown as Node[];

describe('validator messages', () => {
  it('names the step an error is about by its name, where the validator quotes its id (SYN-234)', () => {
    const [error] = convertClientErrors(
      ["[E022] Step 'group_by' requires input 'key' but it is not provided"],
      nodes
    );

    expect(error.stepId).toBe('group_by');
    expect(error.stepName).toBe('Group By');
    expect(error.severity).toBe('error');
  });

  it('does the same for a warning', () => {
    const [warning] = convertClientWarnings(
      ["[W003] Step 'group_by' (GroupBy) has no outgoing edges"],
      nodes
    );

    expect(warning.stepId).toBe('group_by');
    expect(warning.stepName).toBe('Group By');
  });

  it('falls back to what the validator quoted for a step with no name, or one it cannot find', () => {
    const [unnamed, unknown] = convertClientErrors(
      [
        "[E022] Step 'unnamed' requires input 'message'",
        "[E022] Step 'gone' requires input 'message'",
      ],
      nodes
    );

    expect(unnamed).toMatchObject({ stepId: 'unnamed', stepName: 'unnamed' });
    expect(unknown).toMatchObject({ stepId: null, stepName: 'gone' });
  });

  it('attaches no step to a message that names none', () => {
    const [error] = convertClientErrors(['Workflow validation failed'], nodes);

    expect(error.stepId).toBeNull();
    expect(error.stepName).toBeUndefined();
  });
});

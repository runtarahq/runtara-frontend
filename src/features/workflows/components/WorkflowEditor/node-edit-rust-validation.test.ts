import type { Node } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const validate = vi.hoisted(() => vi.fn());
vi.mock('@/features/workflows/utils/rust-workflow-validation', () => ({
  validateExecutionGraphWithRust: validate,
}));

import { validateNodeEditWithRust } from './node-edit-rust-validation';

const nodes = [
  {
    id: 'each',
    type: 'ContainerNode',
    position: { x: 0, y: 0 },
    data: { id: 'each', stepType: 'Split', name: 'Each order' },
  },
] as unknown as Node[];

const edit = () =>
  validateNodeEditWithRust({
    nodes,
    edges: [],
    nodeId: 'each',
    data: { stepType: 'Split', name: 'Each order' } as never,
  });

const invalid = (...errors: string[]) => ({
  status: 'invalid',
  message: 'Workflow validation failed',
  errors,
  warnings: [],
});

beforeEach(() => validate.mockReset());

describe('validateNodeEditWithRust', () => {
  it('applies an edit the validator accepts', async () => {
    validate.mockResolvedValue({
      status: 'valid',
      message: 'ok',
      errors: [],
      warnings: [],
    });

    const result = await edit();

    expect(result.canApply).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it('adds a container before it has a body: that is the canvas’s to fix, not the dialog’s', async () => {
    validate.mockResolvedValue(invalid('[E004] Workflow has no steps defined'));

    const result = await edit();

    expect(result.canApply).toBe(true);
    expect(result.blockingError).toBeUndefined();
    // Still a problem, and still listed.
    expect(result.messages.map((message) => message.message)).toEqual([
      '[E004] Workflow has no steps defined',
    ]);
  });

  it('adds a Conditional before its branches and a routing Switch before its default route', async () => {
    validate.mockResolvedValue(
      invalid(
        "[E140] Conditional step 'each' has no 'true' edge. A Conditional needs both a 'true' and a 'false' edge.",
        "[E141] Routing Switch 'each' has no 'default' edge."
      )
    );

    expect((await edit()).canApply).toBe(true);
  });

  it('refuses an edit for what its dialog can fix, and says which', async () => {
    validate.mockResolvedValue(
      invalid(
        '[E004] Workflow has no steps defined',
        "[E022] Step 'each' requires input 'value' but it is not provided"
      )
    );

    const result = await edit();

    expect(result.canApply).toBe(false);
    expect(result.blockingError).toBe(
      "[E022] Step 'each' requires input 'value' but it is not provided"
    );
    expect(result.messages).toHaveLength(2);
  });

  it('refuses an edit the validator rejects without saying why', async () => {
    validate.mockResolvedValue(invalid());

    const result = await edit();

    expect(result.canApply).toBe(false);
  });

  it('names the step by its name, not the id the validator quotes', async () => {
    validate.mockResolvedValue(
      invalid(
        "[E022] Step 'each' requires input 'value' but it is not provided"
      )
    );

    const [message] = (await edit()).messages;

    expect(message.stepId).toBe('each');
    expect(message.stepName).toBe('Each order');
  });
});

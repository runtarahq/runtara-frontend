import { describe, expect, it } from 'vitest';

import { editorLostItsStep } from './editor-lost-step';

describe('editorLostItsStep (ED-2)', () => {
  it('is true once the edited step has been deleted', () => {
    expect(editorLostItsStep('first', ['second'], null)).toBe(true);
  });

  it('is false while the edited step is on the canvas', () => {
    expect(editorLostItsStep('first', ['first', 'second'], null)).toBe(false);
  });

  it('is false with no editor open', () => {
    expect(editorLostItsStep(null, ['second'], null)).toBe(false);
  });

  it('is false for a step that was just renamed', () => {
    expect(
      editorLostItsStep('first', ['renamed'], {
        oldId: 'first',
        newId: 'renamed',
      })
    ).toBe(false);
  });
});

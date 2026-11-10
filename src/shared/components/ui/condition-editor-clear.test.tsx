import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from './tooltip';
import { ConditionEditor } from './condition-editor';

const condition = (left: string) =>
  JSON.stringify({
    type: 'operation',
    op: 'EQ',
    arguments: [
      { valueType: 'immediate', value: left },
      { valueType: 'immediate', value: 'right' },
    ],
  });

function renderEditor(value: string | undefined) {
  return (
    <TooltipProvider>
      <ConditionEditor value={value} onChange={() => {}} />
    </TooltipProvider>
  );
}

const arg1 = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[placeholder="Arg 1"]')
    ?.value;

describe('ConditionEditor (ED-24)', () => {
  it('follows a changed condition', () => {
    const { container, rerender } = render(renderEditor(condition('first')));
    expect(arg1(container)).toBe('first');
    rerender(renderEditor(condition('second')));
    expect(arg1(container)).toBe('second');
  });

  it('clears when the value is cleared', () => {
    const { container, rerender } = render(renderEditor(condition('first')));
    expect(arg1(container)).toBe('first');
    rerender(renderEditor(undefined));
    expect(arg1(container)).not.toBe('first');
  });
});

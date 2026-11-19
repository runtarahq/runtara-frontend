import { beforeEach, describe, expect, it } from 'vitest';
import type { ValidationMessage } from '@/features/workflows/types/validation';
import {
  getFirstValidationMessage,
  useValidationStore,
} from './validationStore';

let n = 0;
const message = (over: Partial<ValidationMessage>): ValidationMessage => ({
  id: `m${++n}`,
  severity: 'error',
  code: 'E001',
  message: 'Something is wrong',
  source: 'client',
  timestamp: 0,
  ...over,
});
const store = () => useValidationStore.getState();

beforeEach(() => {
  store().clearMessages();
});

describe('validationStore', () => {
  it('marks the step a problem names, and the steps it relates to', () => {
    store().setMessages([
      message({ stepId: 'fetch', relatedStepIds: ['send'] }),
      message({ severity: 'warning', stepId: 'log' }),
      message({}),
    ]);
    expect([...store().stepsWithErrors].sort()).toEqual(['fetch', 'send']);
    expect([...store().stepsWithWarnings]).toEqual(['log']);
  });

  it('finds the first step with an error, past warnings and problems with no step', () => {
    store().setMessages([
      message({}),
      message({ severity: 'warning', stepId: 'log' }),
      message({ stepId: 'send' }),
      message({ stepId: 'fetch' }),
    ]);
    expect(store().getFirstErrorStepId()).toBe('send');
    expect(getFirstValidationMessage(store(), 'send')).toBe(
      'Something is wrong'
    );
    expect(getFirstValidationMessage(store(), 'log')).toBeNull();
  });

  it('has no step to show when nothing names one', () => {
    store().setMessages([message({}), message({ severity: 'warning' })]);
    expect(store().getFirstErrorStepId()).toBeNull();
  });

  it("clears one source's problems and unmarks the steps only they named", () => {
    store().setMessages([
      message({ stepId: 'fetch', source: 'client' }),
      message({ stepId: 'send', source: 'server' }),
    ]);
    store().clearMessages('client');
    expect([...store().stepsWithErrors]).toEqual(['send']);
    store().clearMessages();
    expect(store().messages).toEqual([]);
    expect(store().stepsWithErrors.size).toBe(0);
  });

  it('follows a renamed step: its problems name it by its new id', () => {
    store().setMessages([
      message({ stepId: 'fetch', relatedStepIds: ['send', 'fetch'] }),
      message({ severity: 'warning', stepId: 'fetch' }),
      message({ stepId: 'send' }),
    ]);
    store().renameStep('fetch', 'fetch_orders');
    expect([...store().stepsWithErrors].sort()).toEqual([
      'fetch_orders',
      'send',
    ]);
    expect([...store().stepsWithWarnings]).toEqual(['fetch_orders']);
    expect(store().messages[0]).toMatchObject({
      stepId: 'fetch_orders',
      relatedStepIds: ['send', 'fetch_orders'],
    });
    expect(store().getFirstErrorStepId()).toBe('fetch_orders');
  });

  it('leaves everything as it is for a rename to the same id', () => {
    store().setMessages([message({ stepId: 'fetch' })]);
    const before = store().messages;
    store().renameStep('fetch', 'fetch');
    expect(store().messages).toBe(before);
  });
});

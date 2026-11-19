import { describe, expect, it } from 'vitest';
import { runFailureMessage } from './run-failure';

const refused = (status: number, data: Record<string, unknown>) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data },
});

describe('runFailureMessage', () => {
  it("is the server's error, then its message, then the request's own", () => {
    expect(
      runFailureMessage(
        refused(400, { error: 'orderId is required', message: 'Bad' })
      )
    ).toBe('orderId is required');
    expect(runFailureMessage(refused(400, { message: 'Bad input' }))).toBe(
      'Bad input'
    );
    expect(runFailureMessage(refused(500, {}))).toBe(
      'Request failed with status code 500'
    );
  });

  it('falls back to a validation failure when nothing says more', () => {
    expect(runFailureMessage({})).toBe('Input validation failed');
    expect(runFailureMessage(undefined)).toBe('Input validation failed');
  });

  it('says nothing for a denial the shared handler has already shown', () => {
    expect(
      runFailureMessage(
        refused(403, { code: 'ENTITLEMENT_REQUIRED', error: 'x' })
      )
    ).toBeNull();
    expect(
      runFailureMessage(
        refused(429, { code: 'ENTITLEMENT_LIMIT_EXCEEDED', error: 'x' })
      )
    ).toBeNull();
  });

  it('still reports a 403 that is no entitlement denial', () => {
    expect(runFailureMessage(refused(403, { error: 'Forbidden' }))).toBe(
      'Forbidden'
    );
  });
});

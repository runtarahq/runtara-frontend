import { describe, expect, it } from 'vitest';
import {
  hasHttpResponseOutput,
  httpResponseOutput,
} from './finish-http-response';

describe("a workflow's own HTTP answer", () => {
  it('is an object output with the three parts the server reads', () => {
    const row = httpResponseOutput();
    expect(row).toMatchObject({
      type: 'httpResponse',
      valueType: 'composite',
      typeHint: 'object',
    });
    expect(Object.keys(row.value)).toEqual(['status', 'headers', 'body']);
    expect(row.value.status).toEqual({
      valueType: 'immediate',
      value: 200,
      typeHint: 'integer',
    });
  });

  it('is offered once', () => {
    expect(hasHttpResponseOutput([])).toBe(false);
    expect(hasHttpResponseOutput([{ type: 'response' }])).toBe(false);
    expect(hasHttpResponseOutput([{ type: 'httpResponse' }])).toBe(true);
    expect(hasHttpResponseOutput(undefined)).toBe(false);
  });
});

import type { CompositeObjectValue } from '@/features/workflows/stores/nodeFormStore';

/**
 * The output a synchronous HTTP trigger (and `http-sync`) answers with: a
 * workflow whose output has it is answered with exactly its status, headers
 * and body, in place of the usual envelope.
 */
export const HTTP_RESPONSE_OUTPUT = 'httpResponse';

/** A new Finish output row for the workflow's own HTTP answer, with the
 * three parts the server reads, ready to be filled in. */
export function httpResponseOutput(): {
  type: string;
  value: CompositeObjectValue;
  typeHint: string;
  valueType: 'composite';
} {
  return {
    type: HTTP_RESPONSE_OUTPUT,
    valueType: 'composite',
    typeHint: 'object',
    value: {
      status: { valueType: 'immediate', value: 200, typeHint: 'integer' },
      headers: { valueType: 'composite', value: {} },
      body: { valueType: 'immediate', value: '', typeHint: 'string' },
    },
  };
}

/** Whether the outputs already have the workflow's own HTTP answer. */
export function hasHttpResponseOutput(rows: unknown): boolean {
  return (
    Array.isArray(rows) &&
    rows.some(
      (row) => (row as { type?: unknown } | null)?.type === HTTP_RESPONSE_OUTPUT
    )
  );
}

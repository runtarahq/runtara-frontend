import { isEntitlementDenial } from '@/shared/hooks/api';

/**
 * What to tell the user when a run could not be started, or `null` when they
 * have been told already: a denial for entitlement or capacity (403, or 429
 * for the limit on concurrent runs) is shown by the shared mutation handler
 * with its own message, and saying it again here showed it twice.
 */
export function runFailureMessage(error: unknown): string | null {
  if (isEntitlementDenial(error)) return null;
  const failure = error as
    | {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      }
    | undefined;
  return (
    failure?.response?.data?.error ||
    failure?.response?.data?.message ||
    failure?.message ||
    'Input validation failed'
  );
}

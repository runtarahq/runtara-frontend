import { ManagementAPIClient } from './index';

/**
 * Opens the managed deployment's billing portal. Nothing in this console calls
 * it: a distribution's edition (`src/shared/edition`) does.
 * @public
 */
export async function createBillingPortalSession() {
  const result = await ManagementAPIClient.api.createBillingPortalSession({
    return_url: window.location.origin,
  });

  return result.data;
}

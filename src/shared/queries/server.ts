import { ServerHTTP } from './index';

/** What `GET /health` answers. */
export interface ServerHealth {
  /** The server's release, when it says. */
  version?: string;
}

/**
 * Asks the server whether it is up. Rejects when it is not: a 503 while it is
 * down for maintenance, which also turns maintenance mode on (see
 * `reportResponseStatus`).
 */
export async function getServerHealth(): Promise<ServerHealth> {
  const response = await ServerHTTP.get<ServerHealth | undefined>('/health');
  return response.data ?? {};
}

/** Where the managed deployment's billing portal opened a session. */
export interface BillingPortalSession {
  /** URL of the billing portal session. */
  url: string;
}

/**
 * Opens the managed deployment's billing portal
 * (`POST /api/management/billing-dashboard`), to return to this console when
 * the customer is done. Nothing in this console calls it: a distribution's
 * edition (`src/shared/edition`) does.
 * @public
 */
export async function createBillingPortalSession(): Promise<BillingPortalSession> {
  const response = await ServerHTTP.post<BillingPortalSession>(
    '/api/management/billing-dashboard',
    { return_url: window.location.origin }
  );
  return response.data;
}

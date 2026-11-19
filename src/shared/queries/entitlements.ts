import { RuntimeREST } from './index';
import type { EntitlementsSnapshot } from '@/shared/entitlements';

/**
 * Fetch the resolved entitlement snapshot for the authenticated tenant.
 *
 * See `crates/runtara-server/src/api/handlers/entitlements.rs`.
 */
export async function fetchEntitlements(): Promise<EntitlementsSnapshot> {
  const result = await RuntimeREST.api.getEntitlementsHandler();
  return result.data;
}

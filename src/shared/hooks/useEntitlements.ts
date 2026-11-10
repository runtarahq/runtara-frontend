import { useCustomQuery } from './api';
import {
  PERMISSIVE_FALLBACK,
  type EntitlementsSnapshot,
} from '@/shared/entitlements';
import { fetchEntitlements } from '@/shared/queries/entitlements';

const ENTITLEMENTS_QUERY_KEY = ['entitlements'] as const;

/**
 * Resolve the per-process entitlement snapshot.
 *
 * Resolution order:
 *   1. `window.__RUNTARA_CONFIG__.entitlements` — set only by tests; a
 *      deployment's config never carries one.
 *   2. `GET /api/runtime/entitlements` — what a deployed console reads.
 *   3. `PERMISSIVE_FALLBACK` — last-resort default matching the backend's
 *      "no entitlement env set" behavior, so a misconfigured server can't
 *      black-screen the UI.
 *
 * The snapshot is process-stable on the backend (an `OnceLock` populated at
 * startup), so the query uses `staleTime: Infinity` and never refetches on
 * focus or mount.
 */
export function useEntitlements(): EntitlementsSnapshot {
  return useEntitlementsState().snapshot;
}

/** Whether the snapshot is the tenant's own answer, or still unknown. */
export type EntitlementsStatus = 'loading' | 'ready' | 'failed';

/**
 * The snapshot together with whether it is known. Gates on a feature must not
 * read the permissive fallback as the tenant's answer while it loads: a
 * restricted tenant saw the gated pages until it arrived (SH-3). After a
 * failed fetch the documented fallback applies, so a misconfigured server
 * cannot lock the console's features away.
 */
export function useEntitlementsState(): {
  snapshot: EntitlementsSnapshot;
  status: EntitlementsStatus;
} {
  const inlined = window.__RUNTARA_CONFIG__?.entitlements;

  const query = useCustomQuery<EntitlementsSnapshot>({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: (token) => fetchEntitlements(token),
    enabled: !inlined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  if (inlined) return { snapshot: inlined, status: 'ready' };
  if (query.data) return { snapshot: query.data, status: 'ready' };
  return {
    snapshot: PERMISSIVE_FALLBACK,
    status: query.isError ? 'failed' : 'loading',
  };
}

/**
 * The snapshot for gating features: every feature off while it loads, then
 * the tenant's answer (or, after a failure, the permissive fallback). Agent
 * surfaces keep `useEntitlements`, so the editor does not flash agents as
 * disabled while it loads.
 */
export function useFeatureEntitlements(): EntitlementsSnapshot {
  const { snapshot, status } = useEntitlementsState();
  return status === 'loading' ? FEATURES_UNKNOWN : snapshot;
}

const FEATURES_UNKNOWN: EntitlementsSnapshot = Object.freeze({
  ...PERMISSIVE_FALLBACK,
  features: { database: false, api: false, mcp: false },
}) as EntitlementsSnapshot;

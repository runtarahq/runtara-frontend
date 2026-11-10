import React from 'react';
import { useEntitlementsState } from '@/shared/hooks/useEntitlements';
import { Loader } from '@/shared/components/loader.tsx';
import { isEnabled, type FeatureKey } from '@/shared/entitlements';
import { FeatureDisabled } from '@/shared/pages/FeatureDisabled';

interface EntitlementRouteProps {
  feature: FeatureKey;
  children: React.ReactNode;
}

/**
 * Route guard for entitlement-gated pages. Renders `<FeatureDisabled>` when
 * the feature is off in the resolved snapshot, otherwise the children.
 *
 * Composes inside `<PrivateRoute>`: auth-then-entitlement. An unauthenticated
 * user hitting a gated URL must still go through login first; only then do
 * we decide whether they're allowed to *see* the feature.
 *
 * Hidden menu items in the sidebar are not enough on their own — a user can
 * paste the URL directly. This wrapper is the second-line defense.
 */
export function EntitlementRoute({ feature, children }: EntitlementRouteProps) {
  const { snapshot: entitlements, status } = useEntitlementsState();
  // Not known yet, or could not be read: neither is the tenant's answer, so
  // the gated page stays shut rather than open on the fallback (SH-3).
  if (status === 'loading') return <Loader />;
  if (status === 'failed') {
    return (
      <p role="alert" className="p-6 text-sm">
        Could not check whether this feature is enabled. Reload to try again.
      </p>
    );
  }
  if (!isEnabled(entitlements, feature)) {
    return <FeatureDisabled feature={feature} />;
  }
  return <>{children}</>;
}

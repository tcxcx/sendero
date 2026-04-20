/**
 * @sendero/auth — public surface.
 *
 * Client:  useSenderoAuth()   — React hook (Clerk user + MSCA zustand store)
 * Server:  getServerAuth()    — Next.js App Router helper
 *          getServerAuthHono()— Hono (apps/edge) helper
 *          requireTenant(), requireAgencyAdmin(), requireFinance()
 *
 * Everything below tree-shakes cleanly — client code only pulls the client
 * half, server code only pulls the server half.
 */

'use client';

import { useEffect, useMemo } from 'react';
import { useUser, useOrganization, useOrganizationList, shapeClerkSession } from './clerk';
import { useMscaStore } from './store';
import { restoreFromStorage } from './msca';
import type { SenderoAuth } from './types';

export * from './types';
export { useMscaStore } from './store';
export * as Clerk from './clerk';

// ──────────────────────────────────────────────────────────────────────
// Client hook
// ──────────────────────────────────────────────────────────────────────

/**
 * Single source of truth for the authenticated user in a client component.
 * Combines Clerk's `useUser()` / `useOrganization()` with the MSCA store.
 *
 * Usage:
 *   const { user, tenant, msca, isReady, isFullyLinked } = useSenderoAuth();
 */
export function useSenderoAuth(): SenderoAuth {
  const { user: clerkUser, isLoaded: userLoaded } = useUser();
  const { organization, isLoaded: orgLoaded, membership } = useOrganization();
  const orgList = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const mscaWallet = useMscaStore(s => s.wallet);
  const mscaRestoring = useMscaStore(s => s.isRestoring);
  const setWallet = useMscaStore(s => s.setWallet);
  const setRestoring = useMscaStore(s => s.setRestoring);

  // Lazy-restore the MSCA from localStorage on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRestoring(true);
      try {
        const restored = await restoreFromStorage();
        if (!cancelled) setWallet(restored ?? null);
      } catch {
        if (!cancelled) setWallet(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setRestoring, setWallet]);

  return useMemo<SenderoAuth>(() => {
    const { user, tenant } = shapeClerkSession({
      clerkUser: clerkUser ?? null,
      organization: organization ?? null,
      memberships: orgList.userMemberships,
      role: membership?.role ?? null,
    });

    const msca = mscaWallet
      ? {
          address: mscaWallet.address,
          credentialId: mscaWallet.credential.id,
          onThisDevice: true,
        }
      : null;

    const isReady = userLoaded && orgLoaded && !mscaRestoring;

    return {
      user,
      tenant,
      msca,
      isReady,
      isFullyLinked: Boolean(user && tenant && msca),
    };
  }, [
    clerkUser,
    organization,
    orgList.userMemberships,
    membership?.role,
    mscaWallet,
    userLoaded,
    orgLoaded,
    mscaRestoring,
  ]);
}

// ──────────────────────────────────────────────────────────────────────
// Server helper (re-exported as `@sendero/auth` barrel)
// ──────────────────────────────────────────────────────────────────────
//
// Note: `./server` is a separate entry so RSC doesn't have to ship the
// client hook. Next.js App Router code imports `@sendero/auth/server`
// directly when it needs `getServerAuth()` inside a route handler.
// We re-export here as a courtesy for codebases that don't want two paths.
export { getServerAuth, getServerAuthHono } from './server';

// Tenant guards (server-only; safe to import from client barrel because
// they throw immediately if called without an RSC / route handler context).
export {
  requireTenant,
  requireAgencyAdmin,
  requireFinance,
  requireTraveler,
  requireRole,
  getCurrentTenant,
  loadTenantPolicy,
  listSwitchableTenants,
  AuthError,
  TenantPolicy,
  DEFAULT_POLICY,
  featuresForTier,
} from './tenant';

// MSCA server-side helpers.
export { linkMscaToClerkUser, getMscaForClerkUser, LinkMscaInput } from './msca';

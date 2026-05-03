/**
 * Traveler portal layout — `/me`.
 *
 * Clerk-authed surface for recurring consumers (travelers signed in via
 * phone OTP, no org). The proxy already bypasses the choose-org redirect
 * for `/me/*`; this layout re-checks `auth().userId` so SSR data fetches
 * have a tight invariant. Org members (operators) are bounced to the
 * dashboard instead — the operator console at `/dashboard/*` is the
 * right surface for them.
 *
 * Visual: parchment-on-paper, monospace tab strip, no operator chrome.
 */

import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { prisma } from '@sendero/database';

import { tryPhoneMerge } from '@/lib/traveler-merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABS: Array<{ href: string; label: string }> = [
  { href: '/me', label: 'Trips' },
  { href: '/me/wallet', label: 'Wallet' },
  { href: '/me/stamps', label: 'Stamps' },
  { href: '/me/passport', label: 'Passport' },
];

export default async function TravelerLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId) {
    redirect('/sign-in/traveler?redirect_url=/me');
  }
  // Operators (org-bound users) get the operator dashboard — `/me` is
  // for org-less consumers.
  if (orgId) {
    redirect('/dashboard');
  }

  // Backup kind stamp + phone-anchored merge — both run inline so the
  // first-render data fetches below see the merged state. Phone merge
  // is idempotent and silently no-ops when there's nothing to merge,
  // so the runtime cost is one Clerk getUser + a no-op DB read after
  // the first successful merge.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind !== 'traveler') {
    try {
      const client = await clerkClient();
      const cu = await client.users.getUser(userId);
      const existing = (cu.publicMetadata ?? {}) as Record<string, unknown>;
      if (existing.kind !== 'traveler') {
        await client.users.updateUserMetadata(userId, {
          publicMetadata: { ...existing, kind: 'traveler' },
        });
      }
    } catch (err) {
      console.warn('[me/layout] failed to backfill publicMetadata.kind=traveler', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await tryPhoneMerge(userId).catch(err => {
    console.warn('[me/layout] phone merge failed (non-fatal)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Read display name + provisioning status so the header can render
  // "Welcome, X" + show a setup hint when the wallet hasn't been minted.
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      id: true,
      displayName: true,
      email: true,
      metadata: true,
      gatewaySigner: { select: { address: true } },
    },
  });

  // "Invited by" link — the tenant that first provisioned this traveler
  // (stamped by `agent-traveler-resolver` on first WhatsApp inbound).
  // Free-tier substitute for Clerk custom roles: keeps the relationship
  // visible without burning an org seat.
  const meta = (user?.metadata ?? {}) as Record<string, unknown>;
  const primaryTenantId =
    typeof meta.primaryTenantId === 'string' ? meta.primaryTenantId : null;
  const primaryTenant = primaryTenantId
    ? await prisma.tenant.findUnique({
        where: { id: primaryTenantId },
        select: { displayName: true, slug: true },
      })
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[860px] flex-col gap-6 px-6 pt-10 pb-8">
      <header className="flex flex-col gap-1 border-b border-border pb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero · me</p>
        <h1 className="font-display text-3xl">
          {user?.displayName ?? user?.email ?? 'Traveler portal'}
        </h1>
        {primaryTenant ? (
          <p className="text-sm text-muted-foreground">
            Invited by <span className="text-foreground">{primaryTenant.displayName}</span>
          </p>
        ) : null}
        {!user?.gatewaySigner ? (
          <p className="text-xs text-muted-foreground">
            Wallet provisioning pending — your Gateway depositor will appear after first booking.
          </p>
        ) : null}
      </header>

      <nav
        aria-label="Traveler tabs"
        className="-mt-3 flex gap-6 border-b border-border text-xs uppercase tracking-[0.14em]"
      >
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="-mb-px border-b-2 border-transparent pb-3 text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}

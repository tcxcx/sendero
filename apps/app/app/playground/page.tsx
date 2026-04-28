/**
 * /playground — public sandbox agent loop.
 *
 * Sign-in gated (Clerk middleware blocks unauthenticated access). Once
 * inside, every turn the user runs is forced to sandbox routing
 * regardless of their plan tier — so paid users can dogfood new tools
 * without burning their cap, and free-tier users can take the agent
 * for a real spin without us settling on-chain.
 *
 * Mechanics:
 *   - Reuses /api/agent/chat. The client passes `playground: true` in
 *     the transport body; the route forces `MeterEvent.status = 'sandbox'`
 *     and applies a per-user + per-IP rate limit (Upstash sliding
 *     window, see lib/rate-limit.ts).
 *   - Caller is the active Clerk org. Solo Clerk users without an org
 *     get redirected to onboarding by the existing chat-route auth path.
 *   - No dashboard chrome — the playground is a self-contained surface
 *     so visitors land on a focused chat without nav distraction.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { prisma } from '@sendero/database';

import { PlaygroundClient } from './playground-client';

export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  // Sign-in gate. Public routes list in proxy.ts intentionally excludes
  // /playground so Clerk middleware redirects unauth visitors before
  // they hit this RSC, but a redundant guard here covers the SSR-
  // fallback path where middleware ran with stale claims.
  const { userId, orgId } = await auth();
  if (!userId) {
    redirect('/sign-in?redirect_url=/playground');
  }

  // Resolve the active Clerk org → Sendero tenant. /api/agent/chat
  // does the same lookup on every turn; we mirror it here so the
  // client gets a stable tenantId without a round-trip and the
  // "no workspace yet" path lands on a clean redirect.
  let tenantId: string | null = null;
  if (orgId) {
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true },
    });
    tenantId = tenant?.id ?? null;
  }
  if (!tenantId) {
    redirect('/onboarding?next=%2Fplayground');
  }

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: 'var(--surface-base)',
      }}
    >
      <header
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--hairline-color-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            className="t-mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--vermillion)',
              fontWeight: 600,
            }}
          >
            Sendero · Sandbox Playground
          </span>
          <h1 className="t-h2" style={{ fontSize: 18, margin: 0 }}>
            Try the full agent — no spend, no settlement
          </h1>
        </div>
        <a
          href="/dashboard/console"
          className="t-mono"
          style={{
            padding: '6px 12px',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            border: '1px solid var(--ink)',
            borderRadius: 6,
            color: 'var(--ink)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Go to Console →
        </a>
      </header>
      <div
        style={{
          padding: '8px 24px',
          fontSize: 11,
          color: 'var(--text-dim)',
          background: 'color-mix(in oklab, var(--vermillion) 6%, transparent)',
          borderBottom: '1px solid var(--hairline-color-soft)',
          lineHeight: 1.5,
        }}
      >
        Every turn here writes <code className="t-mono">MeterEvent.status = sandbox</code> — no
        USDC moves, no plan cap charged. Rate limit: 30 turns / 10 min per account, 60 / 10 min
        per network.
      </div>
      <PlaygroundClient tenantId={tenantId} />
    </main>
  );
}

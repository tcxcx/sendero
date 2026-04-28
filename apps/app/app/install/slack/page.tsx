/**
 * Public per-tenant Slack install page.
 *
 * Stage 1 of the multi-tenant channel platform plan. Lets a tenant
 * (e.g. an agency / TMC) share a single URL with their corporate
 * customers — `https://app.sendero.travel/install/slack?tenant=<slug>` —
 * and have those customers install the Sendero Slack app into their
 * own workspace, with the resulting `SlackInstall` row bound to the
 * sharing tenant.
 *
 * Unauthenticated by design: the end customer (Persona C) is NOT a
 * Sendero user. They click "Add to Slack", go through Slack's OAuth,
 * and land on `/install/slack/success`. The tenant gets an email
 * notification when the install completes.
 *
 * Trust posture: today this is co-branded — the bot in Slack is
 * "Sendero", the dashboard side is operated by the tenant. Stage 2
 * adds tenant brand fields (logo, accent, custom display name) so the
 * page looks like the tenant's own. Stage 3 swaps the underlying app
 * to a per-tenant SlackApp. Both deferred until a paying TMC asks.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { buildInstallUrl, DEFAULT_BOT_SCOPES } from '@sendero/slack';

import { docsUrl } from '@/lib/docs-url';
import { signSlackState } from '@/lib/slack-oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tenant?: string }>;
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel';
}

export default async function PublicSlackInstallPage(props: PageProps) {
  const { tenant: tenantSlug } = await props.searchParams;
  if (!tenantSlug) return notFound();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, displayName: true, slug: true },
  });
  if (!tenant) return notFound();

  const clientId = env.slackClientId();
  const redirectUri = env.slackRedirectUri();
  const configured = Boolean(clientId && redirectUri);

  const installUrl = configured
    ? buildInstallUrl({
        clientId: clientId!,
        scopes: DEFAULT_BOT_SCOPES,
        redirectUri: redirectUri!,
        state: signSlackState(tenant.id, 'public'),
      })
    : null;

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--surface-base, #f5ede0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 20px',
      }}
    >
      <article
        className="sd-card-raised"
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '40px 32px',
          background: 'var(--surface-floating, #fdfbf7)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          alt="Sendero"
          width={64}
          height={64}
          style={{ width: 64, height: 64, alignSelf: 'flex-start' }}
        />

        <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-h1" style={{ fontSize: 28, lineHeight: 1.15 }}>
            Add Sendero to your Slack
          </h1>
          <p className="t-body-lg ink-70" style={{ fontSize: 15, lineHeight: 1.55 }}>
            Sendero is an AI travel agent. Operated for your team by{' '}
            <strong style={{ color: 'var(--ink, #1f2a44)' }}>
              {tenant.displayName ?? tenant.slug}
            </strong>
            . Mention <code className="t-mono">@Sendero</code> in any channel after install — it
            books flights, holds seats, settles invoices, and replies inside the thread.
          </p>
        </header>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 16px',
              background: 'var(--tint-vermillion-soft, rgba(251,84,43,0.06))',
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink, #1f2a44)',
            }}
          >
            <strong style={{ fontSize: 12 }}>What Sendero will do in your workspace:</strong>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <li>Read messages in channels you add it to.</li>
              <li>Reply when @-mentioned, in the same thread.</li>
              <li>Post booking confirmations, settlement events, and policy alerts.</li>
              <li>Send DMs only when you start one.</li>
            </ul>
          </div>

          {/* Three-step preview before the CTA — answers "what's about to
              happen if I click this?" before Persona C commits. Cuts the
              mid-OAuth bounces ("wait, what is this asking for?") that
              kill conversion on B2B install pages. */}
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              counterReset: 'next-step',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--text-dim, #555)',
            }}
          >
            {[
              'You’ll be redirected to Slack to approve scopes (~10 seconds).',
              'The bot installs in your workspace automatically.',
              'Add it to a channel with /invite @Sendero, then mention it. It replies in the thread.',
            ].map((step, i) => (
              <li key={`step-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 9,
                    background: 'color-mix(in oklab, var(--ink, #1f2a44) 8%, transparent)',
                    color: 'var(--ink, #1f2a44)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
                  }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {installUrl ? (
            <a
              href={installUrl}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: '12px 18px',
                background: '#4A154B',
                color: '#ffffff',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {/* Slack official "Add to Slack" lockup. The svg is inlined to avoid an asset round-trip. */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                style={{ height: 20, width: 20 }}
                viewBox="0 0 122.8 122.8"
                aria-hidden
              >
                <path
                  d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
                  fill="#E01E5A"
                />
                <path
                  d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
                  fill="#36C5F0"
                />
                <path
                  d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
                  fill="#2EB67D"
                />
                <path
                  d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
                  fill="#ECB22E"
                />
              </svg>
              Add to Slack
            </a>
          ) : (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: 'var(--tint-amber-soft, rgba(217,119,6,0.10))',
                color: 'var(--ink, #1f2a44)',
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Slack OAuth isn't configured for this environment. Ask{' '}
              <strong>{tenant.displayName ?? tenant.slug}</strong> to finish the setup.
            </div>
          )}

          <p
            className="t-mono"
            style={{
              fontSize: 11,
              color: 'var(--text-faint, #888)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            By installing, you authorise Sendero to act on the scopes Slack lists in the consent
            screen. You can remove the app from your workspace at any time.
          </p>
        </section>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: '1px solid var(--hairline-color, rgba(0,0,0,0.06))',
            fontSize: 11,
            color: 'var(--text-faint, #888)',
          }}
        >
          <span>Hosted on Sendero</span>
          <a
            href={docsUrl('/docs/security')}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Security ↗
          </a>
        </footer>
      </article>
    </main>
  );
}

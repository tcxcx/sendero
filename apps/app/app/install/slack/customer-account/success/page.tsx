/**
 * Corporate admin lands here after Slack OAuth completes from the
 * Flow B `/install/slack/customer-account?token=...` flow. They are
 * NOT a Sendero user — just a Slack workspace admin who clicked
 * through. Tell them what to do next inside Slack and reassure them
 * the TMC has the install bound to their CustomerAccount.
 *
 * The OAuth callback redirects here with `?tenant=<slug>`,
 * `?account=<displayName>`, `?team=<teamName>` so we can render
 * attribution without another DB round-trip from this public page.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { docsUrl } from '@/lib/docs-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tenant?: string; account?: string; team?: string }>;
}

export default async function CustomerAccountInstallSuccessPage(props: PageProps) {
  const { tenant: tenantSlug, account, team } = await props.searchParams;
  if (!tenantSlug) return notFound();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { displayName: true, slug: true },
  });
  if (!tenant) return notFound();

  const tmcLabel = tenant.displayName ?? tenant.slug;
  const accountLabel = account && account.length > 0 && account.length <= 100 ? account : 'your team';
  const teamLabel = team && team.length > 0 && team.length <= 80 ? team : 'your workspace';

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
          maxWidth: 520,
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
          <p
            className="t-meta"
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--vermillion)',
            }}
          >
            ✓ Sendero installed
          </p>
          <h1 className="t-h1" style={{ fontSize: 28, lineHeight: 1.15 }}>
            You're set up for <span style={{ color: 'var(--vermillion)' }}>{accountLabel}</span>
          </h1>
          <p className="t-body-lg ink-70" style={{ fontSize: 15, lineHeight: 1.55 }}>
            Sendero is now installed in <strong>{teamLabel}</strong> and bound to your account at{' '}
            <strong>{tmcLabel}</strong>. Check Slack — we sent you a welcome DM with the same
            instructions you'll see below.
          </p>
        </header>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="t-meta" style={{ marginBottom: 0 }}>
            Next steps
          </div>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--ink, #1f2a44)',
            }}
          >
            <Step n={1} title="Invite Sendero to a channel">
              In a channel where your team plans travel (e.g.{' '}
              <code className="t-mono">#travel</code> or <code className="t-mono">#ops</code>),
              run <code className="t-mono">/invite @Sendero</code>.
            </Step>
            <Step n={2} title="Request a trip">
              Mention <code className="t-mono">@Sendero</code> with what you need:
              <br />
              <span
                style={{
                  display: 'inline-block',
                  marginTop: 6,
                  padding: '6px 10px',
                  background: 'var(--tint-vermillion-soft, rgba(251,84,43,0.06))',
                  borderRadius: 6,
                  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
                  fontSize: 12,
                }}
              >
                @Sendero book me NYC → LAX next Tuesday morning, return Friday
              </span>
            </Step>
            <Step n={3} title="Sendero replies in the thread">
              Quotes, holds, ticketing, and settlement land in the same Slack thread.{' '}
              <strong>{tmcLabel}</strong> sees the trip too and can intervene from their dashboard
              if you need approval or a policy exception.
            </Step>
            <Step n={4} title="Boarding passes go to WhatsApp">
              Once you book, Sendero sends the boarding pass + travel updates to the traveler's
              WhatsApp. The same trip stays linked across Slack and WhatsApp.
            </Step>
          </ol>
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
          <span>
            Managed by <strong>{tmcLabel}</strong>
          </span>
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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: 11,
          background: 'var(--ink, #1f2a44)',
          color: 'var(--surface-floating, #fdfbf7)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div className="ink-70" style={{ fontSize: 13.5 }}>
          {children}
        </div>
      </div>
    </li>
  );
}

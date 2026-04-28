/**
 * Persona C lands here after Slack OAuth completes from the public
 * `/install/slack?tenant=<slug>` flow. They are NOT a Sendero user —
 * just a workspace admin who clicked through. Show them what to do
 * next inside Slack and reassure them their tenant has been notified.
 *
 * The OAuth callback redirects here with `?tenant=<slug>` and
 * `?team=<teamName>` so we can render attribution without another DB
 * round-trip from this public page.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';

import { docsUrl } from '@/lib/docs-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tenant?: string; team?: string }>;
}

export default async function PublicSlackInstallSuccessPage(props: PageProps) {
  const { tenant: tenantSlug, team } = await props.searchParams;
  if (!tenantSlug) return notFound();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { displayName: true, slug: true },
  });
  if (!tenant) return notFound();

  const tenantLabel = tenant.displayName ?? tenant.slug;
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
          maxWidth: 480,
          padding: '40px 32px',
          background: 'var(--surface-floating, #fdfbf7)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: 'var(--accent-green, #6A8570)',
            color: '#fdfbf7',
            display: 'grid',
            placeItems: 'center',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          ✓
        </div>

        <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-h1" style={{ fontSize: 26, lineHeight: 1.2 }}>
            Sendero is installed in {teamLabel}.
          </h1>
          <p className="t-body-lg ink-70" style={{ fontSize: 14, lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--ink, #1f2a44)' }}>{tenantLabel}</strong> has been
            notified. They'll set up routing and any policy rules from their side. You don't need to
            do anything else here.
          </p>
        </header>

        <section
          style={{
            padding: '14px 16px',
            background: 'var(--tint-vermillion-soft, rgba(251,84,43,0.06))',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Try it now
          </strong>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink, #1f2a44)',
            }}
          >
            <li>
              Add the bot to a channel: type <code className="t-mono">/invite @Sendero</code> in any
              channel.
            </li>
            <li>
              Mention it: <code className="t-mono">@Sendero hello</code>. It replies in the thread.
            </li>
            <li>
              DM works too. Open a DM to <strong>Sendero</strong> in your sidebar.
            </li>
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

/**
 * Corporate-customer Slack install landing page — Flow B of the B2B2B
 * Slack architecture.
 *
 * A TMC operator generates a signed invite link from
 * `/dashboard/customer-accounts/[id]` and emails it to the corporate
 * admin. The admin clicks → lands here → the page verifies the invite
 * token, looks up the customer account + TMC tenant, and emits an
 * "Add to Slack" button whose OAuth `state` encodes
 * `{kind:'customer_account', customerAccountId, tenantId, flow:'public'}`.
 *
 * Unauthenticated by design — the corporate admin is NOT a Sendero
 * user. After they OAuth, the install lands as
 * `SlackInstall { kind:'customer_account', customerAccountId }` and
 * they're redirected to `/install/slack/customer-account/success`.
 *
 * Distinct from `/install/slack?tenant=<slug>` (the legacy public
 * install) — that flow attaches directly to the Tenant. This one
 * attaches to the CustomerAccount, which is the right shape for
 * B2B2B where one TMC has many downstream corporate clients.
 */

import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { buildInstallUrl, DEFAULT_BOT_SCOPES } from '@sendero/slack';

import { verifyCustomerAccountInvite } from '@/lib/customer-account-invite';
import { docsUrl } from '@/lib/docs-url';
import { signSlackState } from '@/lib/slack-oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function CustomerAccountInstallPage(props: PageProps) {
  const { token } = await props.searchParams;
  if (!token) return notFound();

  const verified = verifyCustomerAccountInvite(token);
  if (verified.ok !== true) {
    return (
      <ErrorCard
        title="Invite link is invalid"
        body={
          verified.reason === 'expired'
            ? "This invite expired. Ask the agency that sent it to mint a fresh link — they're valid for 60 minutes."
            : "This invite link can't be verified. It may have been forwarded incorrectly or tampered with. Ask the agency that sent it to send a fresh one."
        }
      />
    );
  }

  // Tenant-bind in WHERE — can't surface a CustomerAccount that belongs
  // to a different tenant than the signed token attests to.
  const account = await prisma.customerAccount.findFirst({
    where: { id: verified.customerAccountId, tenantId: verified.tenantId },
    select: {
      id: true,
      displayName: true,
      tenant: { select: { displayName: true, slug: true } },
    },
  });
  if (!account) return notFound();

  const clientId = env.slackClientId();
  const redirectUri = env.slackRedirectUri();
  const configured = Boolean(clientId && redirectUri);

  const installUrl = configured
    ? buildInstallUrl({
        clientId: clientId!,
        scopes: DEFAULT_BOT_SCOPES,
        redirectUri: redirectUri!,
        state: signSlackState(verified.tenantId, 'public', {
          kind: 'customer_account',
          customerAccountId: verified.customerAccountId,
        }),
      })
    : null;

  const tmcName = account.tenant.displayName ?? account.tenant.slug;

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
          <p
            className="t-meta"
            style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            Invited by <strong>{tmcName}</strong>
          </p>
          <h1 className="t-h1" style={{ fontSize: 28, lineHeight: 1.15 }}>
            Add Sendero to <span style={{ color: 'var(--vermillion)' }}>{account.displayName}</span>
            's Slack
          </h1>
          <p className="t-body-lg ink-70" style={{ fontSize: 15, lineHeight: 1.55 }}>
            Your travel agency <strong>{tmcName}</strong> uses Sendero to provision trips for your
            company's employees. Install the app in <strong>{account.displayName}</strong>'s Slack
            workspace and your team can request trips by mentioning{' '}
            <code className="t-mono">@Sendero</code> in any channel.
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
              <li>
                Read messages in channels you add it to. Reply when @-mentioned, in the same
                thread.
              </li>
              <li>
                Provision trips for {account.displayName} employees under the policy{' '}
                <strong>{tmcName}</strong> has set.
              </li>
              <li>Post booking confirmations + settlement events when a trip ticketed.</li>
              <li>DM travelers only when starting from a trip request.</li>
            </ul>
          </div>

          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--text-dim, #555)',
            }}
          >
            {[
              `Slack will ask you to approve scopes for ${account.displayName}'s workspace.`,
              'Sendero installs as a bot in your workspace.',
              `Invite @Sendero to a channel like #travel — your team mentions it to request trips.`,
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
              Add to {account.displayName}'s Slack
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
              Slack OAuth isn't configured for this environment. Ask <strong>{tmcName}</strong> to
              finish the setup before retrying.
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
            screen. The install will be managed by <strong>{tmcName}</strong>. You can remove it
            from Slack at any time.
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
          <span>
            Powered by <strong>Sendero</strong>
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

function ErrorCard({ title, body }: { title: string; body: string }) {
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
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '36px 32px',
          background: 'var(--surface-floating, #fdfbf7)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h1 className="t-h1" style={{ fontSize: 22 }}>
          {title}
        </h1>
        <p className="t-body ink-70" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {body}
        </p>
      </article>
    </main>
  );
}

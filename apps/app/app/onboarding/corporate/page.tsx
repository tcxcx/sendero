/**
 * Corporate Slack install wizard.
 *
 * Step 1: collect a corp slug + display name → upsert Tenant (billingTier=business).
 * Step 2: redirect into the Slack OAuth flow with a signed state that
 *         carries the tenantId. Phase 2 already handles the callback
 *         and persists the SlackInstall row.
 */

import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import { buildInstallUrl, DEFAULT_BOT_SCOPES } from '@sendero/slack';
import { redirect } from 'next/navigation';

import { signSlackState } from '@/lib/slack-oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function installCorporate(formData: FormData): Promise<void> {
  'use server';
  const slug = String(formData.get('slug') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const fiscalCountry = String(formData.get('fiscalCountry') ?? '')
    .trim()
    .toUpperCase();
  // Phase 3 — primary chain selection cascades through wallet
  // provisioning, escrow ownership, and trip-stamp NFTs.
  const primaryChainRaw = String(formData.get('primaryChain') ?? 'arc');
  const primaryChain = primaryChainRaw === 'sol' ? 'sol' : 'arc';
  if (!slug || !displayName) return;

  const clientId = env.slackClientId();
  const redirectUri = env.slackRedirectUri();
  if (!clientId || !redirectUri) {
    redirect('/onboarding/corporate?error=slack_not_configured');
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      slug,
      clerkOrgId: `org_corp_${slug}`,
      displayName,
      billingTier: 'business',
      fiscalCountry: fiscalCountry || null,
      primaryChain,
      metadata: { kind: 'corporate' },
    },
    update: {
      displayName,
      billingTier: 'business',
      fiscalCountry: fiscalCountry || null,
      primaryChain,
      metadata: { kind: 'corporate' },
    },
    select: { id: true },
  });

  const state = signSlackState(tenant.id);
  const installUrl = buildInstallUrl({
    clientId: clientId as string,
    scopes: DEFAULT_BOT_SCOPES,
    redirectUri: redirectUri as string,
    state,
    orgInstall: true,
  });
  redirect(installUrl);
}

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default async function CorporateOnboardingPage({ searchParams }: Props) {
  const params = await searchParams;

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <span style={markStyle} />
        <span>Sendero · corporate</span>
      </header>
      <h1 style={h1Style}>Bring Sendero into your workplace.</h1>
      <p style={pStyle}>
        Employees book in Slack. Managers approve in Slack. CFO watches spend in Sendero's admin
        dashboard. Works on Slack Enterprise Grid.
      </p>

      {params.error === 'slack_not_configured' && (
        <div style={errorStyle}>
          <strong>Slack credentials missing.</strong> Set <code>SLACK_CLIENT_ID</code> +{' '}
          <code>SLACK_CLIENT_SECRET</code> + <code>SLACK_REDIRECT_URI</code>.
        </div>
      )}

      <form action={installCorporate} style={formStyle}>
        <label style={labelStyle}>
          <span>Company slug</span>
          <input
            name="slug"
            required
            pattern="[a-z][a-z0-9-]{2,40}"
            placeholder="vale"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Display name</span>
          <input
            name="displayName"
            required
            placeholder="Vale Corporate Travel"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Fiscal country (ISO-3166-1 alpha-2)</span>
          <input name="fiscalCountry" maxLength={2} placeholder="BR" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span>Primary chain</span>
          <select name="primaryChain" defaultValue="arc" style={inputStyle}>
            <option value="arc">Arc — Circle MSCA + USDC settlement (default)</option>
            <option value="sol">Solana — Squads V4 + USDC SPL (Phase 3.x preview)</option>
          </select>
          <span
            style={{
              ...labelStyle,
              fontSize: 10,
              textTransform: 'none',
              letterSpacing: 0,
              color: '#888',
            }}
          >
            Solana tenants reserve their primary-chain intent now; full provisioning lands in Phase
            3.x (cron sweeper + Squads multisig + Solana DCWs).
          </span>
        </label>
        <button type="submit" style={submitStyle}>
          Continue to Slack install →
        </button>
      </form>
    </main>
  );
}

const rootStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
  padding: '64px 24px 80px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  color: '#111',
};
const headerStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 8,
  alignItems: 'center',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#555',
  marginBottom: 32,
};
const markStyle: React.CSSProperties = { width: 12, height: 12, background: '#fb542b' };
const h1Style: React.CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 36,
  letterSpacing: '-0.018em',
  margin: '0 0 16px',
  fontWeight: 450,
  lineHeight: 1.1,
};
const pStyle: React.CSSProperties = { color: '#555', fontSize: 16, margin: '0 0 32px' };
const errorStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: '1px solid #e34',
  color: '#e34',
  marginBottom: 24,
  fontSize: 14,
};
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  border: '1.5px solid #111',
  padding: 24,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#555',
};
const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1.5px solid #e6e6e6',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 14,
};
const submitStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: '#611F69',
  color: '#fff',
  border: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  marginTop: 8,
};

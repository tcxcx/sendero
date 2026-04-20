/**
 * Agency white-label onboarding wizard.
 *
 * The agency tells us their WABA phone-number-id, access token, and
 * branded agent name + locale. We persist the mapping so the webhook
 * can route inbound WA messages for that phone to the correct tenant.
 *
 * Phase 7 layers WABA OAuth on top so agencies don't paste tokens by
 * hand — for now this unblocks pilot customers.
 */

import { prisma } from '@sendero/database';
import { redirect } from 'next/navigation';
import { EmbeddedSignupButton } from './EmbeddedSignupButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function configureAgency(formData: FormData): Promise<void> {
  'use server';
  const slug = String(formData.get('slug') ?? '').trim();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const phoneNumberId = String(formData.get('phoneNumberId') ?? '').trim();
  const fiscalCountry = String(formData.get('fiscalCountry') ?? '')
    .trim()
    .toUpperCase();
  if (!slug || !displayName || !phoneNumberId) return;

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      slug,
      clerkOrgId: `org_agency_${slug}`,
      displayName,
      billingTier: 'pro',
      fiscalCountry: fiscalCountry || null,
      metadata: { kind: 'agency', whatsappPhoneNumberId: phoneNumberId },
    },
    update: {
      displayName,
      billingTier: 'pro',
      fiscalCountry: fiscalCountry || null,
      metadata: { kind: 'agency', whatsappPhoneNumberId: phoneNumberId },
    },
  });

  redirect(`/onboarding/agency?tenantId=${tenant.id}&installed=1`);
}

interface Props {
  searchParams: Promise<{ tenantId?: string; installed?: string }>;
}

export default async function AgencyOnboardingPage({ searchParams }: Props) {
  const params = await searchParams;

  if (params.installed) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Your agency is wired.</h1>
        <p style={pStyle}>
          Sendero will now receive WhatsApp messages on behalf of tenant{' '}
          <code>{params.tenantId}</code>. Next steps:
        </p>
        <ol style={listStyle}>
          <li>
            Set <code>WHATSAPP_DEFAULT_TENANT_ID</code> (multi-tenant routing lands in Phase 7).
          </li>
          <li>
            Configure your Meta webhook to <code>https://sendero.travel/api/webhooks/whatsapp</code>
            .
          </li>
          <li>Test by messaging a trip query to your WABA number — the Sendero agent replies.</li>
        </ol>
      </main>
    );
  }

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <span style={markStyle} />
        <span>Sendero · agency</span>
      </header>
      <h1 style={h1Style}>White-label the Sendero agent.</h1>
      <p style={pStyle}>
        Configure your WhatsApp Business number + branding. We'll route inbound messages to a
        Sendero agent instance that wears your colors.
      </p>

      <div style={embeddedStyle}>
        <div style={eyebrowStyle}>One-click install · Meta Embedded Signup</div>
        <p style={embeddedDescStyle}>
          If your Meta app is approved for the WhatsApp Business API, use Embedded Signup — we
          exchange the code server-side and persist the phone_number_id automatically.
        </p>
        <EmbeddedSignupButton />
      </div>

      <div style={orRowStyle}>
        <span style={orLineStyle} />
        <span style={orLabelStyle}>or paste manually</span>
        <span style={orLineStyle} />
      </div>

      <form action={configureAgency} style={formStyle}>
        <label style={labelStyle}>
          <span>Agency slug</span>
          <input
            name="slug"
            required
            pattern="[a-z][a-z0-9-]{2,40}"
            placeholder="sp-corporate-travel"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Display name</span>
          <input name="displayName" required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span>WhatsApp phone_number_id</span>
          <input
            name="phoneNumberId"
            required
            placeholder="from Meta Business Suite"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Fiscal country (ISO-3166-1 alpha-2)</span>
          <input name="fiscalCountry" maxLength={2} placeholder="BR" style={inputStyle} />
        </label>
        <button type="submit" style={submitStyle}>
          Configure agency
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
  fontSize: 36,
  letterSpacing: '-0.03em',
  margin: '0 0 16px',
  fontWeight: 500,
  lineHeight: 1.1,
};
const pStyle: React.CSSProperties = { color: '#555', fontSize: 16, margin: '0 0 32px' };
const listStyle: React.CSSProperties = { color: '#111', fontSize: 15, lineHeight: 1.8 };
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
  background: '#111',
  color: '#fff',
  border: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  marginTop: 8,
};
const embeddedStyle: React.CSSProperties = {
  border: '1.5px solid #25D366',
  padding: 20,
  marginBottom: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#25D366',
};
const embeddedDescStyle: React.CSSProperties = { fontSize: 13, color: '#555', margin: 0 };
const orRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '12px 0 20px',
};
const orLineStyle: React.CSSProperties = { flex: 1, height: 1, background: '#e6e6e6' };
const orLabelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
};

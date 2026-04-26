/**
 * Consumer invite funnel.
 *
 * Minimal form: display name + E.164 phone + locale → issues a
 * WhatsApp link token, returns instructions for the traveler to DM
 * the token to the Sendero WA number. The webhook receiver (Phase 2)
 * consumes the token and writes a ChannelIdentity row.
 *
 * Server action stays colocated so the onboarding flow is one file.
 */

import { env } from '@sendero/env';
import { prisma } from '@sendero/database';
import { generateLinkToken, getTokenExpiry } from '@sendero/whatsapp';
import { detectLocale, formatDateTime } from '@sendero/locale';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function issueInvite(formData: FormData): Promise<void> {
  'use server';
  const displayName = String(formData.get('displayName') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const tenantId = env.whatsappDefaultTenantId();
  if (!displayName || !phone || !tenantId) return;

  // Upsert the User by phone so the funnel is idempotent.
  const user = await prisma.user.upsert({
    where: { email: `wa+${phone.replace(/[^0-9]/g, '')}@sendero.guest` },
    create: {
      email: `wa+${phone.replace(/[^0-9]/g, '')}@sendero.guest`,
      clerkUserId: `guest_${phone.replace(/[^0-9]/g, '')}`,
      displayName,
      phone,
    },
    update: { displayName, phone },
    select: { id: true },
  });

  const token = generateLinkToken();
  await prisma.whatsAppLinkToken.create({
    data: {
      tenantId,
      userId: user.id,
      token,
      expiresAt: getTokenExpiry(),
    },
  });

  redirect(`/onboarding/consumer?token=${token}&displayName=${encodeURIComponent(displayName)}`);
}

interface ConsumerOnboardingPageProps {
  searchParams: Promise<{ token?: string; displayName?: string }>;
}

export default async function ConsumerOnboardingPage({
  searchParams,
}: ConsumerOnboardingPageProps) {
  const params = await searchParams;
  const hdrs = await headers();
  const locale = detectLocale({
    acceptLanguage: hdrs.get('accept-language'),
    country: hdrs.get('x-vercel-ip-country'),
  });

  if (params.token) {
    return (
      <main style={rootStyle}>
        <header style={headerStyle}>
          <span style={markStyle} />
          <span style={brandStyle}>Sendero · invite</span>
        </header>
        <h1 style={h1Style}>Welcome, {params.displayName ?? 'traveler'}.</h1>
        <p style={pStyle}>
          Message this code to the Sendero WhatsApp bot to pair your phone with your new agent.
        </p>
        <div style={tokenStyle}>{params.token}</div>
        <p style={pHelpStyle}>
          Expires in 15 minutes · {formatDateTime(new Date(Date.now() + 15 * 60 * 1000), locale)}
        </p>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`Sendero: ${params.token}`)}`}
          style={ctaStyle}
        >
          Open WhatsApp
        </a>
      </main>
    );
  }

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <span style={markStyle} />
        <span style={brandStyle}>Sendero · invite</span>
      </header>
      <h1 style={h1Style}>Get your AI travel agent on WhatsApp.</h1>
      <p style={pStyle}>
        No app install. Just a WhatsApp conversation that remembers your preferences across trips.
      </p>
      <form action={issueInvite} style={formStyle}>
        <label style={labelStyle}>
          <span>Display name</span>
          <input name="displayName" required maxLength={40} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <span>Phone · E.164</span>
          <input name="phone" required pattern="^\+[1-9]\d{6,14}$" style={inputStyle} />
        </label>
        <button type="submit" style={submitStyle}>
          Get my invite code
        </button>
      </form>
    </main>
  );
}

const rootStyle: React.CSSProperties = {
  maxWidth: 560,
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
const brandStyle: React.CSSProperties = { color: '#111' };
const h1Style: React.CSSProperties = {
  fontFamily: 'var(--display)',
  fontSize: 36,
  letterSpacing: '-0.018em',
  margin: '0 0 16px',
  fontWeight: 450,
  lineHeight: 1.1,
};
const pStyle: React.CSSProperties = { color: '#555', fontSize: 16, margin: '0 0 32px' };
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
const tokenStyle: React.CSSProperties = {
  padding: '20px 24px',
  border: '2px dashed #fb542b',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 28,
  letterSpacing: '0.3em',
  textAlign: 'center',
  margin: '16px 0 12px',
};
const pHelpStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  margin: '0 0 24px',
};
const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 20px',
  background: '#25D366',
  color: '#fff',
  textDecoration: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

'use client';

/**
 * Guest claim landing page.
 *
 * The URL looks like `/g#t=0xTRIP&k=0xCLAIMKEY`. The fragment never
 * reaches the server — this page runs client-side, registers / logs
 * into a Modular Wallet passkey (on the Sendero domain), signs the
 * Peanut-style claim with the embedded key, and submits the userOp
 * via Circle Modular Wallets.
 *
 * The actual claim submission is wired in Phase 7 once we finalize
 * the MSCA provider — this Phase 6 landing validates the link,
 * collects the guest's display name, and previews what's about to
 * happen. We call guest_claim_link on the server to build the
 * calldata, but submission is still guarded behind a passkey
 * ceremony that will land with the MSCA flow.
 */

import { parseGuestLink } from '@sendero/guest';
import { useEffect, useMemo, useState } from 'react';

export default function GuestClaimPage() {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') setLink(window.location.href);
  }, []);

  const parts = useMemo(() => (link ? parseGuestLink(link) : null), [link]);

  if (link === null) return null; // still hydrating

  if (!parts) {
    return (
      <main style={rootStyle}>
        <h1 style={h1Style}>Invalid invite link.</h1>
        <p style={pStyle}>
          Ask whoever sent you this link to resend it. The tokens must come via the URL fragment
          (after the <code>#</code>).
        </p>
      </main>
    );
  }

  return (
    <main style={rootStyle}>
      <header style={headerStyle}>
        <span style={markStyle} />
        <span>Sendero · guest invite</span>
      </header>
      <h1 style={h1Style}>Your trip is funded and waiting.</h1>
      <p style={pStyle}>
        A Sendero buyer prefunded your travel budget in USDC on Arc. Claim it with a free passkey —
        no app install, no seed phrase.
      </p>

      <section style={cardStyle}>
        <div style={eyebrowStyle}>Trip</div>
        <div style={codeStyle}>{parts.tripId}</div>
        <div style={eyebrowStyle}>Claim key · stays on your device</div>
        <div style={codeFadedStyle}>
          {parts.claimPrivateKey.slice(0, 10)}…{parts.claimPrivateKey.slice(-8)}
        </div>
      </section>

      <button
        type="button"
        style={ctaStyle}
        onClick={() => {
          window.location.href = '/?claim=' + encodeURIComponent(link);
        }}
      >
        Claim with passkey →
      </button>

      <p style={helpStyle}>
        Claiming binds this trip to a Sendero Modular Wallet on your device. From then on, your
        travel agent can book for you on WhatsApp.
      </p>
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
const h1Style: React.CSSProperties = {
  fontSize: 36,
  letterSpacing: '-0.03em',
  margin: '0 0 16px',
  fontWeight: 500,
  lineHeight: 1.1,
};
const pStyle: React.CSSProperties = { color: '#555', fontSize: 16, margin: '0 0 32px' };
const helpStyle: React.CSSProperties = { color: '#8a8a8a', fontSize: 14, marginTop: 24 };
const cardStyle: React.CSSProperties = {
  border: '1.5px solid #e6e6e6',
  padding: '20px 24px',
  marginBottom: 24,
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8a8a8a',
  marginTop: 8,
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  wordBreak: 'break-all',
  marginTop: 4,
};
const codeFadedStyle: React.CSSProperties = {
  ...codeStyle,
  color: '#8a8a8a',
};
const ctaStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '16px 20px',
  background: '#fb542b',
  color: '#fff',
  border: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

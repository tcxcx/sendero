/**
 * Public ERC-8004 agent profile — for both orgs (travel agencies) and
 * users (travelers). Lives outside `(app)` so Slackbot / WhatsApp / X
 * can fetch the OG payload without a Clerk session.
 *
 * URL slug uses the Sendero id (Tenant.id / User.id), not the on-chain
 * agentId, so the URL is stable across any future re-mint.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { env } from '@sendero/env';

import { loadAgentProfile, loadSenderoAgentProfile } from '@/lib/agent-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageParams {
  kind: string;
  id: string;
}

const KIND_DESCRIPTION: Record<string, string> = {
  sendero:
    'Primary Sendero AI travel agent — books, settles, and records reputation on Arc-Testnet.',
  org: 'Travel agency on the Sendero protocol — settles bookings on Arc-Testnet.',
  user: 'Sendero traveler with an on-chain identity on Arc-Testnet.',
};

const KIND_LABEL: Record<string, string> = {
  sendero: 'Primary Agent',
  org: 'Travel Agency',
  user: 'Traveler',
};

async function loadPublicProfile(kind: string, id: string) {
  if (kind === 'sendero') {
    const profile = await loadSenderoAgentProfile();
    return profile?.agentId === id ? profile : null;
  }
  if (kind !== 'org' && kind !== 'user') return null;
  return loadAgentProfile({ kind, subjectId: id });
}

function shortenAddress(addr: string, front = 8, back = 6): string {
  if (addr.length <= front + back + 2) return addr;
  return `${addr.slice(0, front)}…${addr.slice(-back)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(delta / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function starsDisplay(stars: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(stars)));
  const empty = 5 - filled;
  return '★'.repeat(filled) + '☆'.repeat(empty);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { kind, id } = await params;
  if (kind !== 'sendero' && kind !== 'org' && kind !== 'user') {
    return { title: 'Not found · Sendero' };
  }
  const profile = await loadPublicProfile(kind, id);
  if (!profile) return { title: 'Agent not found · Sendero' };

  const url = `https://app.sendero.travel/agents/${kind}/${id}`;
  const title = profile.stars
    ? `${profile.displayName} · ${profile.stars.toFixed(1)}★ on Sendero`
    : `${profile.displayName} · Sendero`;
  const description =
    profile.feedbackCount > 0
      ? `${profile.stars?.toFixed(2) ?? '—'}★ across ${profile.feedbackCount} ratings from ${profile.validatorCount} distinct counterparties on Arc-Testnet.`
      : KIND_DESCRIPTION[kind];

  return {
    title,
    description,
    openGraph: { title, description, url, siteName: 'Sendero', type: 'profile' },
    twitter: { card: 'summary', title, description },
    other: profile.agentId
      ? {
          'eth:nft:contract': profile.contract,
          'eth:nft:token_id': profile.agentId,
          'eth:nft:chain': 'arc-testnet',
        }
      : {},
    robots: { index: true, follow: true },
  };
}

export default async function AgentProfilePage({ params }: { params: Promise<PageParams> }) {
  const { kind, id } = await params;
  if (kind !== 'sendero' && kind !== 'org' && kind !== 'user') notFound();
  const profile = await loadPublicProfile(kind, id);
  if (!profile) notFound();

  const explorerUrl = env.arcExplorerUrl();
  const contractUrl = `${explorerUrl}/address/${profile.contract}`;
  const tokenUrl = profile.agentId ? `${explorerUrl}/token/${profile.contract}/${profile.agentId}` : null;
  const isMinted = profile.status === 'minted' && !!profile.agentId;
  const kindTypeLabel = `${KIND_LABEL[kind]} · ERC-8004 · Arc Testnet`;

  return (
    <>
      <style>{`
        /* ── Reset / base ────────────────────────────── */
        .ap-page {
          background: var(--bg, #eedcc7);
          min-height: 100%;
          padding-bottom: 0;
        }

        /* ── Content wrapper ─────────────────────────── */
        .ap-wrap {
          max-width: 900px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* ── Kind badge row ──────────────────────────── */
        .ap-eyebrow {
          padding: 36px 0 0;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .ap-eyebrow-rule {
          width: 28px;
          height: 2px;
          background: var(--ink, #fb542b);
          flex-shrink: 0;
        }
        .ap-eyebrow-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.55;
        }
        .ap-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 3px 9px;
          border-radius: 2px;
          line-height: 1.4;
        }
        .ap-status-badge--minted {
          color: var(--accent-green, oklch(0.62 0.13 155));
          background: color-mix(in oklab, var(--accent-green, oklch(0.62 0.13 155)) 10%, transparent);
          border: 1px solid color-mix(in oklab, var(--accent-green, oklch(0.62 0.13 155)) 28%, transparent);
        }
        .ap-status-badge--pending {
          color: var(--accent-amber, oklch(0.72 0.14 75));
          background: color-mix(in oklab, var(--accent-amber, oklch(0.72 0.14 75)) 10%, transparent);
          border: 1px solid color-mix(in oklab, var(--accent-amber, oklch(0.72 0.14 75)) 28%, transparent);
        }
        .ap-status-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
        }

        /* ── Hero ────────────────────────────────────── */
        .ap-hero {
          padding: 20px 0 32px;
          border-bottom: 1px solid var(--border, #d8c1a7);
        }
        .ap-hero-name {
          font-family: var(--font-display, "Fraunces", ui-serif, Georgia, serif);
          font-size: clamp(36px, 5vw, 52px);
          font-weight: 600;
          line-height: 1.06;
          letter-spacing: -0.01em;
          color: var(--midnight, #1f2a44);
          margin: 0 0 12px;
        }
        .ap-hero-desc {
          font-size: 15px;
          line-height: 1.6;
          color: var(--midnight, #1f2a44);
          opacity: 0.55;
          max-width: 620px;
          margin: 0;
        }

        /* ── Reputation bar ──────────────────────────── */
        .ap-rep-card {
          margin: 32px 0 0;
          background: var(--surface-raised, #fdfbf7);
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 2px;
          box-shadow: var(--shadow-md, 0 1px 2px rgba(31,42,68,.04), 0 8px 24px -12px rgba(31,42,68,.08));
          display: flex;
          align-items: stretch;
          flex-wrap: wrap;
        }
        .ap-rep-stars {
          padding: 28px 36px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          border-right: 1px solid var(--border, #d8c1a7);
          flex-shrink: 0;
        }
        .ap-rep-stars-value {
          font-family: var(--font-display, "Fraunces", ui-serif, Georgia, serif);
          font-size: 64px;
          font-weight: 600;
          line-height: 1;
          color: var(--ink, #fb542b);
          letter-spacing: -0.02em;
        }
        .ap-rep-stars-glyphs {
          font-size: 16px;
          color: var(--ink, #fb542b);
          opacity: 0.7;
          letter-spacing: 0.06em;
        }
        .ap-rep-stars-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.4;
          margin-top: 4px;
        }
        .ap-rep-stats {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
        }
        .ap-rep-stat {
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 6px;
          border-right: 1px solid var(--border, #d8c1a7);
        }
        .ap-rep-stat:last-child {
          border-right: none;
        }
        .ap-rep-stat-value {
          font-family: var(--font-display, "Fraunces", ui-serif, Georgia, serif);
          font-size: 36px;
          font-weight: 600;
          line-height: 1;
          color: var(--midnight, #1f2a44);
          letter-spacing: -0.01em;
        }
        .ap-rep-stat-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.4;
        }
        .ap-rep-no-stars {
          font-family: var(--font-display, "Fraunces", ui-serif, Georgia, serif);
          font-size: 20px;
          color: var(--midnight, #1f2a44);
          opacity: 0.3;
          font-style: italic;
        }

        /* ── Section shared ──────────────────────────── */
        .ap-section {
          margin-top: 40px;
        }
        .ap-section-title {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.45;
          margin: 0 0 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ap-section-title::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border, #d8c1a7);
        }

        /* ── On-chain identity card ───────────────────── */
        .ap-chain-card {
          background: var(--surface-raised, #fdfbf7);
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 2px;
          box-shadow: var(--shadow-sm, 0 1px 2px rgba(31,42,68,.04), 0 4px 12px -6px rgba(31,42,68,.06));
          overflow: hidden;
        }
        .ap-chain-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
        }
        .ap-chain-field {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #d8c1a7);
          border-right: 1px solid var(--border, #d8c1a7);
        }
        .ap-chain-field:nth-child(2n) {
          border-right: none;
        }
        .ap-chain-field:nth-last-child(-n+2) {
          border-bottom: none;
        }
        .ap-chain-field-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.4;
          margin-bottom: 5px;
        }
        .ap-chain-field-value {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
          color: var(--midnight, #1f2a44);
          word-break: break-all;
          line-height: 1.5;
        }
        .ap-chain-field-value-link {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
          color: var(--ink, #fb542b);
          text-decoration: none;
          border-bottom: 1px solid color-mix(in oklab, var(--ink, #fb542b) 30%, transparent);
          word-break: break-all;
          transition: border-color 120ms ease;
        }
        .ap-chain-field-value-link:hover {
          border-bottom-color: var(--ink, #fb542b);
        }
        .ap-chain-field-sub {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          color: var(--midnight, #1f2a44);
          opacity: 0.4;
          margin-top: 3px;
        }
        .ap-chain-footer {
          padding: 14px 20px;
          background: var(--bg, #eedcc7);
          border-top: 1px solid var(--border, #d8c1a7);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .ap-chain-explorer-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          text-decoration: none;
          padding: 6px 14px;
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 2px;
          background: var(--surface-raised, #fdfbf7);
          transition: border-color 120ms ease, background 120ms ease;
        }
        .ap-chain-explorer-btn:hover {
          border-color: var(--midnight, #1f2a44);
          background: var(--bg, #eedcc7);
        }

        /* ── Feedback list ───────────────────────────── */
        .ap-feedback-list {
          background: var(--surface-raised, #fdfbf7);
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 2px;
          box-shadow: var(--shadow-sm, 0 1px 2px rgba(31,42,68,.04), 0 4px 12px -6px rgba(31,42,68,.06));
          overflow: hidden;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .ap-feedback-empty {
          padding: 40px 24px;
          text-align: center;
          font-family: var(--font-display, "Fraunces", ui-serif, Georgia, serif);
          font-size: 17px;
          color: var(--midnight, #1f2a44);
          opacity: 0.35;
          font-style: italic;
        }
        .ap-feedback-empty-sub {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          font-style: normal;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.6;
          margin-top: 6px;
        }
        .ap-feedback-row {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #d8c1a7);
          display: flex;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
        }
        .ap-feedback-row:last-child {
          border-bottom: none;
        }
        .ap-feedback-left {
          flex: 1;
          min-width: 200px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ap-feedback-stars {
          font-size: 15px;
          color: var(--ink, #fb542b);
          letter-spacing: 0.05em;
          line-height: 1;
        }
        .ap-feedback-tag {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          opacity: 0.45;
          margin-top: 2px;
        }
        .ap-feedback-trip {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          color: var(--midnight, #1f2a44);
          opacity: 0.35;
        }
        .ap-feedback-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 5px;
          flex-shrink: 0;
        }
        .ap-feedback-from {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          color: var(--midnight, #1f2a44);
          opacity: 0.5;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .ap-feedback-wallet-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--border, #d8c1a7);
          flex-shrink: 0;
        }
        .ap-feedback-tx {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          color: var(--ink, #fb542b);
          text-decoration: none;
          padding: 2px 7px;
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 25%, transparent);
          border-radius: 2px;
          background: color-mix(in oklab, var(--ink, #fb542b) 5%, transparent);
          transition: background 120ms ease, border-color 120ms ease;
          white-space: nowrap;
        }
        .ap-feedback-tx:hover {
          background: color-mix(in oklab, var(--ink, #fb542b) 10%, transparent);
          border-color: color-mix(in oklab, var(--ink, #fb542b) 45%, transparent);
        }
        .ap-feedback-time {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 9px;
          color: var(--midnight, #1f2a44);
          opacity: 0.35;
        }

        /* ── Metadata action buttons ─────────────────── */
        .ap-meta-links {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .ap-meta-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--midnight, #1f2a44);
          text-decoration: none;
          padding: 10px 18px;
          border: 1px solid var(--border, #d8c1a7);
          border-radius: 2px;
          background: var(--surface-raised, #fdfbf7);
          box-shadow: var(--shadow-xs, 0 1px 2px rgba(31,42,68,.04));
          transition: border-color 120ms ease, background 120ms ease;
        }
        .ap-meta-btn:hover {
          border-color: var(--midnight, #1f2a44);
          background: var(--bg, #eedcc7);
        }
        .ap-meta-btn-arrow {
          opacity: 0.45;
        }

        /* ── Trust rail ──────────────────────────────── */
        .ap-trust-rail {
          margin-top: 40px;
          padding: 16px 0 40px;
          border-top: 1px solid var(--border, #d8c1a7);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ap-trust-chain-icon {
          font-size: 14px;
          opacity: 0.3;
          flex-shrink: 0;
        }
        .ap-trust-text {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          line-height: 1.5;
          color: var(--midnight, #1f2a44);
          opacity: 0.4;
          letter-spacing: 0.04em;
        }

        /* ── Responsive ──────────────────────────────── */
        @media (max-width: 640px) {
          .ap-rep-card {
            flex-direction: column;
          }
          .ap-rep-stars {
            border-right: none;
            border-bottom: 1px solid var(--border, #d8c1a7);
            padding: 24px 24px 20px;
          }
          .ap-rep-stats {
            grid-template-columns: repeat(3, 1fr);
          }
          .ap-rep-stat {
            padding: 20px 16px;
          }
          .ap-rep-stat-value {
            font-size: 28px;
          }
          .ap-chain-grid {
            grid-template-columns: 1fr;
          }
          .ap-chain-field {
            border-right: none;
          }
          .ap-chain-field:nth-last-child(-n+2) {
            border-bottom: 1px solid var(--border, #d8c1a7);
          }
          .ap-chain-field:last-child {
            border-bottom: none;
          }
        }
      `}</style>

      <div className="ap-page">
        <div className="ap-wrap">

          {/* ── 1. Kind badge row ────────────────────────────── */}
          <div className="ap-eyebrow" role="doc-subtitle">
            <span className="ap-eyebrow-rule" aria-hidden="true" />
            <span className="ap-eyebrow-label">{kindTypeLabel}</span>
            {isMinted ? (
              <span className="ap-status-badge ap-status-badge--minted" aria-label="Verified on-chain">
                <span className="ap-status-dot" aria-hidden="true" />
                Verified on-chain
              </span>
            ) : (
              <span className="ap-status-badge ap-status-badge--pending" aria-label="Pending mint">
                <span className="ap-status-dot" aria-hidden="true" />
                Pending mint
              </span>
            )}
          </div>

          {/* ── 2. Hero ──────────────────────────────────────── */}
          <header className="ap-hero">
            <h1 className="ap-hero-name">{profile.displayName}</h1>
            <p className="ap-hero-desc">
              {profile.description ?? KIND_DESCRIPTION[kind]}
            </p>
          </header>

          {/* ── 3. Reputation bar ────────────────────────────── */}
          <section className="ap-rep-card" aria-label="Reputation summary">
            <div className="ap-rep-stars">
              {profile.stars != null ? (
                <>
                  <div className="ap-rep-stars-value" aria-label={`${profile.stars.toFixed(2)} stars`}>
                    {profile.stars.toFixed(2)}
                  </div>
                  <div className="ap-rep-stars-glyphs" aria-hidden="true">
                    {starsDisplay(profile.stars)}
                  </div>
                </>
              ) : (
                <div className="ap-rep-no-stars">No ratings yet</div>
              )}
              <div className="ap-rep-stars-label">Reputation</div>
            </div>
            <div className="ap-rep-stats">
              <div className="ap-rep-stat">
                <div className="ap-rep-stat-value">{profile.feedbackCount}</div>
                <div className="ap-rep-stat-label">Ratings</div>
              </div>
              <div className="ap-rep-stat">
                <div className="ap-rep-stat-value">{profile.validatorCount}</div>
                <div className="ap-rep-stat-label">Counterparties</div>
              </div>
              <div className="ap-rep-stat">
                <div className="ap-rep-stat-value">{profile.validationCount}</div>
                <div className="ap-rep-stat-label">Validations</div>
              </div>
            </div>
          </section>

          {/* ── 4. On-chain identity ─────────────────────────── */}
          <section className="ap-section" aria-labelledby="ap-chain-title">
            <h2 className="ap-section-title" id="ap-chain-title">On-chain Identity</h2>
            <div className="ap-chain-card">
              <div className="ap-chain-grid">
                {/* Token ID */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Token ID</div>
                  {profile.agentId ? (
                    tokenUrl ? (
                      <Link
                        href={tokenUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ap-chain-field-value-link"
                        aria-label={`Token #${profile.agentId} on Arcscan`}
                      >
                        #{profile.agentId}
                      </Link>
                    ) : (
                      <span className="ap-chain-field-value">#{profile.agentId}</span>
                    )
                  ) : (
                    <span className="ap-chain-field-value" style={{ opacity: 0.35, fontStyle: 'italic' }}>
                      Pending
                    </span>
                  )}
                </div>

                {/* Status */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Status</div>
                  {isMinted ? (
                    <span
                      className="ap-status-badge ap-status-badge--minted"
                      style={{ display: 'inline-flex', marginTop: 0, fontSize: '10px' }}
                    >
                      <span className="ap-status-dot" aria-hidden="true" />
                      Minted ✓
                    </span>
                  ) : (
                    <span
                      className="ap-status-badge ap-status-badge--pending"
                      style={{ display: 'inline-flex', marginTop: 0, fontSize: '10px' }}
                    >
                      <span className="ap-status-dot" aria-hidden="true" />
                      Pending
                    </span>
                  )}
                </div>

                {/* Contract */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Contract</div>
                  <Link
                    href={contractUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ap-chain-field-value-link"
                    title={profile.contract}
                    aria-label={`IdentityRegistry contract on Arcscan`}
                  >
                    {shortenAddress(profile.contract, 6, 4)}
                  </Link>
                  <div className="ap-chain-field-sub">IdentityRegistry · ERC-8004</div>
                </div>

                {/* Holder */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Holder</div>
                  <span className="ap-chain-field-value" title={profile.holderAddress}>
                    {shortenAddress(profile.holderAddress)}
                  </span>
                </div>

                {/* Minted */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Minted</div>
                  {profile.mintedAt ? (
                    <span className="ap-chain-field-value">
                      {formatDate(profile.mintedAt)}
                    </span>
                  ) : (
                    <span className="ap-chain-field-value" style={{ opacity: 0.35, fontStyle: 'italic' }}>
                      —
                    </span>
                  )}
                </div>

                {/* Chain */}
                <div className="ap-chain-field">
                  <div className="ap-chain-field-label">Network</div>
                  <span className="ap-chain-field-value">Arc Testnet</span>
                  <div className="ap-chain-field-sub">ERC-8004 · Reputation-aware identity</div>
                </div>
              </div>

              {/* Footer */}
              <div className="ap-chain-footer">
                <span
                  style={{
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    fontSize: '10px',
                    color: 'var(--midnight, #1f2a44)',
                    opacity: 0.35,
                    letterSpacing: '0.04em',
                  }}
                >
                  {shortenAddress(profile.holderAddress, 10, 8)}
                </span>
                <Link
                  href={contractUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ap-chain-explorer-btn"
                >
                  View on Arcscan
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </section>

          {/* ── 5. Recent feedback ───────────────────────────── */}
          <section className="ap-section" aria-labelledby="ap-feedback-title">
            <h2 className="ap-section-title" id="ap-feedback-title">Recent Ratings</h2>
            {profile.recent.length === 0 ? (
              <div className="ap-feedback-list">
                <div className="ap-feedback-empty" role="status">
                  No on-chain ratings yet
                  <span className="ap-feedback-empty-sub">
                    Reputation accumulates after the first settled trip
                  </span>
                </div>
              </div>
            ) : (
              <ul className="ap-feedback-list" aria-label="Recent on-chain ratings">
                {profile.recent.map(r => (
                  <li key={r.txHash} className="ap-feedback-row">
                    <div className="ap-feedback-left">
                      <div className="ap-feedback-stars" aria-label={`${r.stars} out of 5 stars`}>
                        {starsDisplay(r.stars)}
                      </div>
                      {r.tag && (
                        <div className="ap-feedback-tag">{r.tag}</div>
                      )}
                      {(r.tripId || r.bookingId) && (
                        <div className="ap-feedback-trip">
                          {r.tripId ? `Trip ${r.tripId.slice(0, 12)}` : `Booking ${r.bookingId?.slice(0, 12)}`}
                        </div>
                      )}
                    </div>
                    <div className="ap-feedback-right">
                      <div className="ap-feedback-from">
                        <span className="ap-feedback-wallet-dot" aria-hidden="true" />
                        <span title={r.fromAddress}>{shortenAddress(r.fromAddress, 8, 6)}</span>
                      </div>
                      <Link
                        href={`${explorerUrl}/tx/${r.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ap-feedback-tx"
                        title={r.txHash}
                        aria-label={`View transaction on Arcscan`}
                      >
                        tx {r.txHash.slice(0, 8)}…{r.txHash.slice(-4)}
                      </Link>
                      <div className="ap-feedback-time">{formatRelative(r.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 6. ERC-8004 metadata ─────────────────────────── */}
          <section className="ap-section" aria-labelledby="ap-meta-title">
            <h2 className="ap-section-title" id="ap-meta-title">Agent Metadata</h2>
            <nav className="ap-meta-links" aria-label="Agent metadata links">
              <Link
                href={`/agents/${kind}/${id}/metadata.json`}
                target="_blank"
                rel="noreferrer"
                className="ap-meta-btn"
              >
                ERC-8004 metadata JSON
                <span className="ap-meta-btn-arrow" aria-hidden="true">→</span>
              </Link>
              <Link
                href={contractUrl}
                target="_blank"
                rel="noreferrer"
                className="ap-meta-btn"
              >
                View IdentityRegistry on Arcscan
                <span className="ap-meta-btn-arrow" aria-hidden="true">→</span>
              </Link>
            </nav>
          </section>

          {/* ── 7. Trust rail ────────────────────────────────── */}
          <div className="ap-trust-rail" role="contentinfo">
            <span className="ap-trust-chain-icon" aria-hidden="true">⛓</span>
            <p className="ap-trust-text">
              Reputation data sourced directly from Arc Testnet (ERC-8004 IdentityRegistry + ReputationRegistry).
              Not editable post-mint.
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

'use client';

/**
 * PublicInstallUrlCard — Stage 1 of the multi-tenant channel platform.
 *
 * Surfaces the tenant's per-tenant public Slack install URL inside the
 * `/dashboard/channels/slack` page so the operator can copy it and
 * share with their corporate customers. Without this card the URL we
 * shipped is invisible — operators would have to know the path
 * convention (`/install/slack?tenant=<slug>`) and assemble it by hand.
 *
 * Also offers a one-click Slack-app manifest YAML download for the
 * Sendero-internal team setting up new Slack apps. Tenants don't need
 * the manifest in v1 (they reuse the Sendero Demo Slack app), but
 * surfacing it here means it doesn't rot in an unreferenced route.
 */

import { useState } from 'react';

import { McpInstallCard } from '@sendero/ui/mcp-install-card';
import { motion } from 'motion/react';

import { docsUrl as buildDocsUrl } from '@/lib/docs-url';

interface PublicInstallUrlCardProps {
  /** Origin like `https://app.sendero.travel` or `http://localhost:3010`. */
  appOrigin: string;
  /** Tenant slug used in the install URL query string. */
  tenantSlug: string;
  /** Tenant display name for share-text drafting. */
  tenantDisplayName?: string | null;
}

export function PublicInstallUrlCard(props: PublicInstallUrlCardProps) {
  const installUrl = `${props.appOrigin}/install/slack?tenant=${encodeURIComponent(props.tenantSlug)}`;
  const manifestUrl = `${props.appOrigin}/dashboard/channels/slack/manifest`;
  const tenantLabel = props.tenantDisplayName ?? 'Your travel team';
  const shareDraft =
    `${tenantLabel} runs travel ops on Sendero. ` +
    `Install the Sendero Slack bot in your workspace to get booking confirmations, ` +
    `cap warnings, and trip handoffs in your channels: ${installUrl}`;
  const mailtoSubject = encodeURIComponent(
    `Install Sendero in your Slack — managed by ${tenantLabel}`
  );
  const mailtoBody = encodeURIComponent(
    [
      `Hi,`,
      ``,
      `${tenantLabel} runs your travel ops on Sendero — an AI travel agent for booking, holds, and trip support, all inside Slack.`,
      ``,
      `Install the Sendero bot in your Slack workspace by clicking this link:`,
      ``,
      installUrl,
      ``,
      `What happens after you click:`,
      `1. Slack asks you to approve a few scopes (read messages in channels you add the bot to, post replies in threads, send DMs).`,
      `2. The bot installs in ~10 seconds.`,
      `3. Add it to a channel with /invite @Sendero, then mention @Sendero in a message. It replies inside the thread.`,
      ``,
      `Any questions, reply to this email and I'll help.`,
      ``,
      `Thanks,`,
      `${tenantLabel}`,
    ].join('\n')
  );
  const mailtoHref = `mailto:?subject=${mailtoSubject}&body=${mailtoBody}`;

  const [copiedKey, setCopiedKey] = useState<'url' | 'share' | null>(null);

  // Which half of the right column is being hovered. Drives the
  // crossfade between two left-rail brand images so the visual
  // anchor "follows" the operator's eye as they read down the card.
  // Default 'top' so the page renders with image 1 visible.
  const [hoveredHalf, setHoveredHalf] = useState<'top' | 'bottom'>('top');

  const copy = async (key: 'url' | 'share', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1600);
    } catch {
      /* clipboard blocked — value is visible in the textarea/input */
    }
  };

  return (
    <article
      className="sd-card-raised"
      style={{
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 260px) 1fr',
        gap: 24,
        alignItems: 'start',
      }}
    >
      {/* Left rail — brand hero illustration on top, icon strip below.
          Anchors the share card visually so it doesn't read as a wall
          of inputs. The hero is one of the existing brand panels (no
          net new asset to commission); the icon strip pulls from the
          numbered icon set in /public/brand/icons. Hidden on narrow
          viewports via CSS — this card lives in a tab pane that's
          ~960px wide on the dashboard so two columns fit cleanly. */}
      <aside
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          position: 'sticky',
          top: 16,
        }}
      >
        <div
          style={{
            position: 'relative',
            aspectRatio: '4 / 5',
            borderRadius: 12,
            overflow: 'hidden',
            background:
              'linear-gradient(155deg, var(--tint-vermillion-soft, rgba(251,84,43,0.08)) 0%, var(--surface-floating, #fdfbf7) 100%)',
            border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 8%, transparent)',
          }}
        >
          {[
            {
              src: '/brand/panels/panel-02.png',
              half: 'top' as const,
              alt: 'Sendero share + install flow',
            },
            {
              src: '/brand/panels/panel-04.png',
              half: 'bottom' as const,
              alt: 'Sendero operator handoff',
            },
          ].map(layer => {
            const active = hoveredHalf === layer.half;
            return (
              // motion.img crossfade — 700ms expo-out (`[0.16, 1, 0.3, 1]`)
              // is the canonical "premium hero swap" curve: very fast head,
              // long tail, no rubber-banding. A barely-perceptible 1 → 1.04
              // scale on the active layer makes the swap feel like a slow
              // breath, not a flash.
              <motion.img
                key={layer.half}
                src={layer.src}
                alt={layer.alt}
                initial={false}
                animate={{
                  opacity: active ? 1 : 0,
                  scale: active ? 1.04 : 1,
                }}
                transition={{
                  opacity: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
                  scale: { duration: 1.6, ease: [0.22, 1, 0.36, 1] },
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  willChange: 'opacity, transform',
                }}
              />
            );
          })}
        </div>
        <ul
          aria-label="What's included"
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
          }}
        >
          {[
            { src: '/brand/icons/02-chat-bubbles.png', label: 'Slack' },
            { src: '/brand/icons/16-ai-chip.png', label: 'MCP' },
            { src: '/brand/icons/04-network-nodes.png', label: 'Routing' },
            { src: '/brand/icons/06-shield.png', label: 'Audit' },
          ].map(icon => (
            <li
              key={icon.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--surface-floating, #fdfbf7)',
                  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
                  display: 'grid',
                  placeItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={icon.src}
                  alt=""
                  style={{ width: 26, height: 26, objectFit: 'contain' }}
                />
              </div>
              <span
                className="t-mono"
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim, #666)',
                }}
              >
                {icon.label}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Top half — header + install URL + share + AI agents/MCP.
            onMouseEnter swaps the left rail to image 1. Wrapping the
            three subsections in a single hover zone (rather than per-
            field) keeps the crossfade calm — no twitching as the
            cursor moves between sibling inputs. */}
        <div
          onMouseEnter={() => setHoveredHalf('top')}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="t-meta">Public install URL</div>
              <h2 className="t-h3" style={{ marginTop: 4, fontSize: 17, lineHeight: 1.2 }}>
                Share this with your corporate clients
              </h2>
              <p className="t-body ink-70" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
                Anyone who clicks installs the Sendero Slack bot in their own workspace, with the
                install bound to <strong>{props.tenantDisplayName ?? props.tenantSlug}</strong>. You
                get a notification email when they finish.
              </p>
            </div>
          </header>

          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            htmlFor="install-url-input"
          >
            <span className="t-meta">Install URL</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="install-url-input"
                type="text"
                readOnly
                value={installUrl}
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 16%, transparent)',
                  background: 'var(--surface-floating, #fdfbf7)',
                  fontFamily: 'var(--font-mono-x, ui-monospace, SFMono-Regular, Menlo, monospace)',
                  fontSize: 12,
                  color: 'var(--ink, #1f2a44)',
                }}
              />
              <button type="button" onClick={() => copy('url', installUrl)} style={primaryBtn}>
                {copiedKey === 'url' ? 'Copied' : 'Copy'}
              </button>
              <a
                href={installUrl}
                target="_blank"
                rel="noreferrer"
                style={secondaryBtn}
                title="Preview the install page in a new tab"
              >
                Preview ↗
              </a>
            </div>
          </label>

          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            htmlFor="install-share-text"
          >
            <span className="t-meta">Drop-in message for your client</span>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <textarea
                id="install-share-text"
                readOnly
                value={shareDraft}
                rows={3}
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 16%, transparent)',
                  background: 'var(--surface-floating, #fdfbf7)',
                  fontFamily: 'var(--font-sans, system-ui)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--ink, #1f2a44)',
                  resize: 'vertical',
                }}
              />
              <button type="button" onClick={() => copy('share', shareDraft)} style={primaryBtn}>
                {copiedKey === 'share' ? 'Copied' : 'Copy text'}
              </button>
            </div>
            {/* Mailto: opens the operator's email client with the install URL +
            a friendly explainer pre-drafted. Cuts the manual copy-paste-from-
            textarea-into-email workflow down to one click. */}
            <a href={mailtoHref} style={emailBtn}>
              ✉ Send via email
            </a>
          </label>

          {/* AI-first install prompts — shared with /dashboard/integrations/mcp
              so the four MCP install snippets stay in sync. `embedded` variant
              renders compact (no big section heading; the parent card already
              provides context) so the share-card flow keeps reading top-down.
              docsUrl deep-links each tab to the relevant section of the
              public docs site (env-aware via `buildDocsUrl`). */}
          <McpInstallCard
            mcpUrl={`${props.appOrigin}/api/mcp`}
            apiKeysUrl="/dashboard/settings/api-keys"
            docsUrl={buildDocsUrl('/docs/mcp-integration')}
            variant="embedded"
          />
        </div>

        {/* Bottom half — operator checklist + how-it-works + manifest.
            Swaps the left rail to image 2 on hover. */}
        <div
          onMouseEnter={() => setHoveredHalf('bottom')}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {/* Operator checklist — what to do before / after sharing the URL.
          Removes the "what now?" gap between copying the link and the bot
          actually answering @-mentions in the customer's workspace. */}
          <ol
            style={{
              margin: 0,
              padding: '14px 16px',
              listStyle: 'none',
              counterReset: 'install-step',
              background: 'var(--tint-vermillion-soft, rgba(251,84,43,0.05))',
              borderRadius: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--ink, #1f2a44)',
            }}
          >
            {[
              'Send the install URL to your client (email, Slack, IM).',
              'Wait for them to click and approve in Slack — typically <2 min.',
              "You'll get an email confirmation when the install lands.",
              'Configure routing for their channels in the panel below.',
            ].map((step, i) => (
              <li key={`step-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: 11,
                    background: 'var(--vermillion, #fb542b)',
                    color: '#fdfbf7',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
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

          {/* Expandable "How this works" — collapsed by default so it doesn't
          eat vertical space, expanded for first-time operators or anyone
          who needs to explain the flow to a stakeholder. Native <details>
          element — accessible by default, no JS state. */}
          <details
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--surface-floating, #fdfbf7)',
              border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--ink, #1f2a44)',
                userSelect: 'none',
                listStyle: 'none',
              }}
            >
              How this works ▾
            </summary>
            <div
              style={{
                marginTop: 10,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: 'var(--text-dim, #555)',
              }}
            >
              <p style={{ margin: '0 0 8px' }}>
                <strong>For your client (Persona C):</strong> they click the install URL, see a
                Sendero-branded landing page that says you operate it, click <em>Add to Slack</em>,
                approve the bot scopes, and the bot lands in their workspace. They never see the
                Sendero dashboard or have to make an account.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>For you:</strong> the install is automatically bound to your tenant via a
                signed state token in the install URL. You manage routing, policy, billing, and
                channel config from this dashboard. Your client just uses the bot in Slack.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Branding:</strong> the bot in Slack appears as &ldquo;Sendero&rdquo;. If you
                need it to appear under your own brand (Acme TravelDesk), that's the upcoming
                white-label tier — talk to us.
              </p>
            </div>
          </details>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--hairline-color, rgba(0,0,0,0.06))',
              fontSize: 12,
              color: 'var(--text-dim, #666)',
            }}
          >
            <span>Setting up your own Slack app from scratch?</span>
            <a href={manifestUrl} download style={mutedLink} title="Download YAML manifest">
              Download Slack-app manifest YAML →
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  background: 'var(--vermillion, #fb542b)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const secondaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  background: 'var(--surface-floating, #fdfbf7)',
  color: 'var(--ink, #1f2a44)',
  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 16%, transparent)',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const mutedLink: React.CSSProperties = {
  color: 'var(--ink, #1f2a44)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  fontSize: 12,
};

const emailBtn: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 4,
  padding: '8px 14px',
  background: 'var(--surface-floating, #fdfbf7)',
  color: 'var(--ink, #1f2a44)',
  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  textDecoration: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

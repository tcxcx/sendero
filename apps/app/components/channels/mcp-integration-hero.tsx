'use client';

/**
 * McpIntegrationHero — left-rail brand visual for /dashboard/integrations/mcp.
 *
 * Mirrors the layout pattern from PublicInstallUrlCard's left rail —
 * a tall hero panel with a crossfading second image on hover, plus a
 * 4-icon strip below labelled with the four canonical client tiers
 * (Claude Desktop / Claude Code / Codex / Cursor). The hover-swap is
 * decorative here (no right-column hover triggers wired up yet); it
 * runs on a slow auto-rotate so the page never feels static.
 *
 * Lives next to McpInstallCard rather than inside it because the hero
 * is page-furniture, not card-content — keeps the install card itself
 * embeddable inside other cards (Slack share) without dragging a
 * second hero illustration along.
 */

import { useEffect, useState } from 'react';

import { motion } from 'motion/react';

const PANELS = [
  { src: '/brand/panels/panel-03.png', alt: 'Sendero MCP — agent integration' },
  { src: '/brand/panels/panel-05.png', alt: 'Sendero MCP — tool surface' },
] as const;

const ICONS = [
  { src: '/brand/icons/16-ai-chip.png', label: 'MCP' },
  { src: '/brand/icons/04-network-nodes.png', label: 'Tools' },
  { src: '/brand/icons/06-shield.png', label: 'Auth' },
  { src: '/brand/icons/11-cost-gauge.png', label: 'Meter' },
] as const;

export function McpIntegrationHero() {
  const [active, setActive] = useState(0);

  // Slow auto-rotate so the hero breathes. 6s cadence — long enough
  // that it doesn't pull focus away from the right rail's content.
  useEffect(() => {
    const t = setInterval(() => setActive(prev => (prev + 1) % PANELS.length), 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside
      onMouseEnter={() => setActive(1)}
      onMouseLeave={() => setActive(0)}
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
        {PANELS.map((panel, i) => {
          const isActive = active === i;
          return (
            <motion.img
              key={panel.src}
              src={panel.src}
              alt={panel.alt}
              initial={false}
              animate={{
                opacity: isActive ? 1 : 0,
                scale: isActive ? 1.04 : 1,
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
        aria-label="MCP integration capabilities"
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {ICONS.map(icon => (
          <li
            key={icon.label}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
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
              <img src={icon.src} alt="" style={{ width: 26, height: 26, objectFit: 'contain' }} />
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
  );
}

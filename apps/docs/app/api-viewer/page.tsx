/**
 * /api-viewer — landing page for the Sendero OpenAPI surface.
 *
 * The Scalar `<ApiReferenceReact />` integration is parked behind a
 * known zod version mismatch (Scalar's bundle calls `.prefault()`
 * which is a zod v4 feature; the workspace pins zod v3). Until the
 * Scalar/zod resolution is sorted out (either by upgrading Scalar to
 * a v3-compatible release or by lifting the workspace to zod v4),
 * this route ships a graceful fallback:
 *
 *   - link to the raw OpenAPI 3.1 doc at /api/openapi.json
 *   - link to the canonical /docs/api-reference MDX page
 *   - link to the live MCP endpoint
 *
 * No client-side crash. No "Application error" screen. The docs DX
 * stays clean while the Scalar fix lands separately.
 */

import { ArrowUpRightIcon, BookOpenIcon, FileJsonIcon, PlugIcon } from 'lucide-react';
import type { Metadata } from 'next';

import { resolvePublicOrigin } from '@sendero/seo';

// `/api/openapi.json` lives on the app origin, not the docs origin.
// Resolve dynamically so the link routes to localhost:3010 in dev and
// app.sendero.travel in prod.
const APP_ORIGIN = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_APP_URL,
  'https://app.sendero.travel'
);

export const metadata: Metadata = {
  title: 'API reference · Sendero',
  description:
    'Live OpenAPI 3.1 reference for every Sendero agent tool. Direct JSON, hosted MDX guide, and the MCP endpoint.',
};

interface SurfaceLink {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  external?: boolean;
}

const SURFACES: SurfaceLink[] = [
  {
    href: `${APP_ORIGIN.replace(/\/$/, '')}/api/openapi.json`,
    label: 'Raw OpenAPI 3.1 doc',
    description:
      'Stable JSON spec generated from the canonical tool registry. Wire your client codegen, MCP indexer, or LLM at this URL.',
    icon: <FileJsonIcon size={18} aria-hidden="true" />,
    external: true,
  },
  {
    href: '/docs/api-reference',
    label: 'Hosted API guide',
    description:
      'MDX-rendered tour of every endpoint with auth, rate-limit, and example payloads. Indexed for /llms.txt.',
    icon: <BookOpenIcon size={18} aria-hidden="true" />,
  },
  {
    href: '/docs/mcp-integration',
    label: 'MCP integration',
    description:
      'How to wire Sendero into Claude Code, Claude Desktop, Cursor, Codex, and VS Code via the same /api/mcp endpoint.',
    icon: <PlugIcon size={18} aria-hidden="true" />,
  },
];

export default function ApiViewerPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: '64px max(24px, 6vw)',
      }}
    >
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            marginBottom: 12,
          }}
        >
          API reference
        </div>
        <h1
          style={{
            fontFamily: 'var(--display)',
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 450,
            letterSpacing: '-0.012em',
            lineHeight: 1.05,
            margin: '0 0 16px',
            textWrap: 'balance',
          }}
        >
          Every Sendero tool, one OpenAPI doc.
        </h1>
        <p
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 16,
            lineHeight: 1.6,
            color: 'var(--text-dim)',
            margin: '0 0 40px',
            maxWidth: '62ch',
          }}
        >
          Sendero exposes ~49 tools through a single OpenAPI 3.1 surface and an MCP endpoint that
          mirrors it. Pick the entry point that fits your client.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SURFACES.map(surface => (
            <a
              key={surface.href}
              href={surface.href}
              target={surface.external ? '_blank' : undefined}
              rel={surface.external ? 'noreferrer' : undefined}
              className="api-surface-card"
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 24px',
                alignItems: 'start',
                gap: 16,
                padding: '20px 24px',
                border: '1px solid color-mix(in oklab, var(--text) 12%, transparent)',
                background: 'var(--bg-elev)',
                color: 'var(--text)',
                textDecoration: 'none',
                transition: 'border-color 150ms ease-out, transform 150ms ease-out',
              }}
            >
              <span
                style={{
                  marginTop: 2,
                  color: 'var(--ink)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {surface.icon}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{surface.label}</span>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                  {surface.description}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'color-mix(in oklab, var(--ink) 80%, transparent)',
                    marginTop: 4,
                  }}
                >
                  {surface.href}
                </span>
              </div>
              <span
                style={{
                  marginTop: 2,
                  color: 'color-mix(in oklab, var(--text) 50%, transparent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                <ArrowUpRightIcon size={16} aria-hidden="true" />
              </span>
            </a>
          ))}
        </div>

        <p
          style={{
            marginTop: 48,
            fontSize: 12,
            color: 'color-mix(in oklab, var(--text) 50%, transparent)',
            fontFamily: 'var(--mono)',
          }}
        >
          The interactive Scalar viewer is temporarily disabled — see /api-viewer/page.tsx for the
          zod version-resolution note.
        </p>
      </div>

      <style>{`
        .api-surface-card:hover {
          border-color: var(--ink) !important;
          transform: translateY(-1px);
        }
      `}</style>
    </main>
  );
}

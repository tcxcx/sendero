import Link from 'next/link';
import { TOOL_PRICING } from '@sendero/tools/pricing';

/**
 * Docs landing page. Editorial, not marketing — it mirrors the
 * "one hero moment, then links" shape used by the main app.
 */
export default function HomePage() {
  const toolCount = Object.keys(TOOL_PRICING).length;
  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: '80px 24px',
        maxWidth: 840,
        margin: '0 auto',
      }}
    >
      <p className="label" style={{ color: 'var(--ink)' }}>
        Sendero / Developer docs
      </p>
      <h1
        style={{
          fontSize: 'clamp(40px, 6vw, 72px)',
          lineHeight: 1.02,
          letterSpacing: '-0.02em',
          margin: '16px 0 24px',
        }}
      >
        Book flights. <span style={{ color: 'var(--ink)' }}>Settle on-chain.</span>
      </h1>
      <p
        style={{
          fontSize: 18,
          color: 'var(--text-dim)',
          maxWidth: 560,
          marginBottom: 48,
        }}
      >
        Sendero exposes {toolCount} MCP tools — search flights, quote FX, settle a 4-way commission
        split — each one priced in sub-cent USDC via x402 nanopayments on Circle Arc.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link
          href="/docs"
          style={{
            padding: '12px 20px',
            background: 'var(--ink)',
            color: '#fafaf7',
            borderRadius: 4,
            textDecoration: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Read the docs &rarr;
        </Link>
        <Link
          href="/docs/quickstart"
          style={{
            padding: '12px 20px',
            border: '1.5px solid var(--ink)',
            color: 'var(--ink)',
            borderRadius: 4,
            textDecoration: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          5-minute quickstart
        </Link>
      </div>
    </main>
  );
}

import { senderoBrand } from '@sendero/ui/brand';
import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

const meta: Meta = {
  title: 'Brand/Brand Book',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Sendero brand book, palette, mark usage, illustration direction, and static PDF reference.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const colorEntries = Object.values(senderoBrand.colors).slice(0, 4);

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div
        style={{
          color: 'var(--sendero-vermillion)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {kicker}
      </div>
      <h2
        style={{
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: 0,
          lineHeight: 1.05,
          margin: '10px 0 0',
        }}
      >
        {title}
      </h2>
    </div>
  );
}

function AssetCard({
  src,
  title,
  tone = 'paper',
}: {
  src: string;
  title: string;
  tone?: 'paper' | 'dark';
}) {
  return (
    <figure
      style={{
        border: '1px solid var(--border)',
        background: tone === 'dark' ? '#0b0b0b' : 'var(--sendero-paper)',
        margin: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center' }}>
        <img
          alt=""
          src={src}
          style={{
            display: 'block',
            height: '100%',
            objectFit: 'contain',
            padding: tone === 'dark' ? 28 : 0,
            width: '100%',
          }}
        />
      </div>
      <figcaption
        style={{
          background: 'var(--bg-elev)',
          borderTop: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          padding: 12,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </figcaption>
    </figure>
  );
}

export const Overview: Story = {
  render: () => (
    <React.Fragment>
      <main
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          minHeight: '100dvh',
          padding: '56px 32px 80px',
        }}
      >
        <div style={{ margin: '0 auto', maxWidth: 1120 }}>
          <section
            style={{
              border: '1px solid var(--border)',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 0.95fr) minmax(320px, 1.05fr)',
              minHeight: 420,
            }}
          >
            <div style={{ padding: 40 }}>
              <div
                style={{
                  color: 'var(--sendero-vermillion)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                Brand book
              </div>
              <h1
                style={{
                  fontSize: 64,
                  fontWeight: 500,
                  letterSpacing: 0,
                  lineHeight: 1,
                  margin: '18px 0 0',
                }}
              >
                {senderoBrand.name} is a smart travel guide with taste.
              </h1>
              <p
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 18,
                  lineHeight: 1.6,
                  marginTop: 24,
                  maxWidth: 640,
                }}
              >
                The identity should feel intelligent, curious, editorial, warm, guided, and premium
                without becoming a generic travel app, chat product, or cold corporate SaaS tool.
              </p>
              <a
                href={senderoBrand.assets.brandBookPdf}
                style={{
                  background: 'var(--sendero-vermillion)',
                  color: '#fff7ec',
                  display: 'inline-flex',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  marginTop: 28,
                  padding: '12px 16px',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                }}
              >
                Open brand book PDF
              </a>
            </div>
            <div
              style={{
                background: 'var(--sendero-paper)',
                borderLeft: '1px solid var(--border)',
                display: 'grid',
                placeItems: 'center',
                padding: 36,
              }}
            >
              <img
                alt=""
                src={senderoBrand.assets.logo}
                style={{ display: 'block', maxWidth: 320, width: '100%' }}
              />
            </div>
          </section>

          <section style={{ display: 'grid', gap: 18, marginTop: 40 }}>
            <SectionTitle
              kicker="Color system"
              title="Vermillion leads. Midnight, sea, and sand support."
            />
            <div
              style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
            >
              {colorEntries.map(color => (
                <div
                  key={color.name}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-elev)' }}
                >
                  <div style={{ background: color.hex, height: 112 }} />
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 16, fontWeight: 500 }}>{color.name}</div>
                    <code
                      style={{
                        color: 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                      }}
                    >
                      {color.hex}
                    </code>
                    <p
                      style={{
                        color: 'var(--text-dim)',
                        fontSize: 12,
                        lineHeight: 1.5,
                        margin: '8px 0 0',
                      }}
                    >
                      {color.role}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ display: 'grid', gap: 18, marginTop: 40 }}>
            <SectionTitle
              kicker="Asset system"
              title="Use the mark and map-room art with restraint."
            />
            <div
              style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            >
              <AssetCard
                src={senderoBrand.assets.logo}
                title="Primary binocular mark"
                tone="dark"
              />
              <AssetCard src={senderoBrand.assets.banner} title="Wordmark and editorial banner" />
              <AssetCard
                src={senderoBrand.assets.heroBanner}
                title="Wide travel-map illustration"
              />
            </div>
          </section>

          <section style={{ display: 'grid', gap: 18, marginTop: 40 }}>
            <SectionTitle kicker="Rules" title={senderoBrand.internalRule} />
            <div
              style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
            >
              <div style={{ border: '1px solid var(--border)', padding: 20 }}>
                <h3 style={{ marginTop: 0 }}>Preserve the mark</h3>
                <ul style={{ color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 0 }}>
                  {senderoBrand.icon.elements.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div style={{ border: '1px solid var(--border)', padding: 20 }}>
                <h3 style={{ marginTop: 0 }}>Illustration should prefer</h3>
                <ul style={{ color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 0 }}>
                  {senderoBrand.illustration.preferred.slice(0, 6).map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>
    </React.Fragment>
  ),
};

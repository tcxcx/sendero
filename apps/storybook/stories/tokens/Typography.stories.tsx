import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

const meta: Meta = {
  title: 'Tokens/Typography',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

const sizes = [
  { label: 'Display', size: 72, weight: 500, tracking: '-0.02em' },
  { label: 'Title', size: 40, weight: 500, tracking: '-0.015em' },
  { label: 'Heading', size: 24, weight: 500, tracking: '-0.01em' },
  { label: 'Subheading', size: 18, weight: 500, tracking: '-0.005em' },
  { label: 'Body', size: 13, weight: 400, tracking: '-0.005em' },
  { label: 'Caption', size: 11, weight: 400, tracking: '0' },
];

const monoSamples = [
  { label: 'Meter', size: 11, style: 'label' as const },
  { label: 'Code', size: 13, style: 'code' as const },
  { label: 'Tx hash', size: 14, style: 'hash' as const },
];

export const GeistSansScale: Story = {
  render: () => (
    <div style={{ padding: 32, fontFamily: 'var(--font-sans)' }}>
      <h2 style={{ marginTop: 0 }}>Geist Sans</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        Default UI stack. Negative tracking at display sizes; neutral at body.
      </p>
      <div style={{ display: 'grid', gap: 24 }}>
        {sizes.map(s => (
          <div key={s.label}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--text-dim)',
              }}
            >
              {s.label} · {s.size}px · {s.weight}
            </div>
            <div
              style={{
                fontSize: s.size,
                fontWeight: s.weight,
                letterSpacing: s.tracking,
                lineHeight: 1.1,
                color: 'var(--text)',
              }}
            >
              Book flights. Settle on-chain.
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const GeistMono: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0, fontFamily: 'var(--font-sans)' }}>Geist Mono</h2>
      <p style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-sans)' }}>
        Labels, meter readouts, tx hashes. Ships with stylistic set 05 for humanist punctuation.
      </p>
      <div style={{ display: 'grid', gap: 20 }}>
        {monoSamples.map(s => (
          <div key={s.label}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              {s.label}
            </div>
            {s.style === 'label' && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: s.size,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                }}
              >
                tool · search_flights · 0.002 usdc
              </div>
            )}
            {s.style === 'code' && (
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: s.size,
                  color: 'var(--text)',
                }}
              >
                {'{ ok: true, meter: { usdc_display: "0.01" } }'}
              </code>
            )}
            {s.style === 'hash' && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: s.size,
                  color: 'var(--ink)',
                  fontFeatureSettings: "'ss05'",
                }}
              >
                0x7a3f…c1a0
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  ),
};

const displaySamples = [
  {
    label: 'Hero',
    size: 76,
    weight: 450,
    tracking: '-0.015em',
    sample: 'Book flights. Settle on-chain.',
  },
  {
    label: 'Section',
    size: 44,
    weight: 450,
    tracking: '-0.012em',
    sample: 'Trips that route themselves.',
  },
  {
    label: 'Article',
    size: 32,
    weight: 450,
    tracking: '-0.018em',
    sample: 'How guest passes work',
  },
  {
    label: 'Onboarding',
    size: 36,
    weight: 450,
    tracking: '-0.018em',
    sample: 'Welcome to Sendero.',
  },
];

export const FrauncesDisplay: Story = {
  render: () => (
    <div style={{ padding: 32, fontFamily: 'var(--font-sans)' }}>
      <h2 style={{ marginTop: 0 }}>Fraunces — Display</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        Editorial face for hero h1s, marketing section h2s, docs page titles, and onboarding
        headlines. Variable axes (SOFT, WONK, opsz, wght). Never use below 22px. Pair with weight
        450 + negative letter-spacing + text-wrap: balance.
      </p>
      <div style={{ display: 'grid', gap: 28 }}>
        {displaySamples.map(s => (
          <div key={s.label}>
            <div
              style={{
                fontFamily: 'var(--font-mono-x)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--text-dim)',
              }}
            >
              {s.label} · {s.size}px · {s.weight} · tracking {s.tracking}
            </div>
            <div
              style={{
                fontFamily: 'var(--display)',
                fontSize: s.size,
                fontWeight: s.weight,
                letterSpacing: s.tracking,
                lineHeight: 1.05,
                color: 'var(--text)',
                textWrap: 'balance' as React.CSSProperties['textWrap'],
                fontFeatureSettings: "'ss01'",
              }}
            >
              {s.sample}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

const monoXSamples = [
  { label: 'Eyebrow', size: 11, tracking: '0.14em', text: 'Vertical AI for travel ops' },
  { label: 'Nav', size: 11, tracking: '0.12em', text: 'Docs · Pricing · API · Sign in' },
  { label: 'Tag', size: 10, tracking: '0.08em', text: 'Settled · USDC · Arc' },
  { label: 'Tx hash', size: 12, tracking: '0.01em', text: '0x7a3f4b…c1a0', upper: false },
  { label: 'Meter', size: 10, tracking: '0.10em', text: 'tool · search_flights · 0.002 USDC' },
];

export const IoskeleyMonoX: Story = {
  render: () => (
    <div style={{ padding: 32, fontFamily: 'var(--font-sans)' }}>
      <h2 style={{ marginTop: 0 }}>IoskeleyMono — Display Mono (--mono-x)</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        The character mono. Berkeley-Mono-shaped Iosevka build. Use for eyebrows, ALL-CAPS labels,
        nav, tags, tx-hash chips, terminal stamps. Default mono (var(--mono)) stays Geist Mono for
        inline code and dense data. In Storybook, mono-x falls back to Geist Mono — the live apps
        stamp Ioskeley via next/font on &lt;html&gt;.
      </p>
      <div style={{ display: 'grid', gap: 24 }}>
        {monoXSamples.map(s => (
          <div key={s.label}>
            <div
              style={{
                fontFamily: 'var(--font-mono-x)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--ink)',
                marginBottom: 4,
              }}
            >
              {s.label} · {s.size}px · tracking {s.tracking}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono-x)',
                fontSize: s.size,
                letterSpacing: s.tracking,
                textTransform: s.upper === false ? 'none' : 'uppercase',
                color: 'var(--text)',
              }}
            >
              {s.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const FullStack: Story = {
  render: () => (
    <div style={{ padding: 48, background: 'var(--bg)', minHeight: '100vh' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono-x)',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          marginBottom: 18,
        }}
      >
        Vertical AI for travel ops
      </div>
      <h1
        style={{
          fontFamily: 'var(--display)',
          fontSize: 'clamp(42px, 6.4vw, 76px)',
          fontWeight: 450,
          letterSpacing: '-0.015em',
          lineHeight: 1.01,
          margin: '0 0 18px',
          color: 'var(--text)',
          textWrap: 'balance' as React.CSSProperties['textWrap'],
          maxWidth: 780,
        }}
      >
        Trips that route themselves. Settled on-chain.
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 18,
          lineHeight: 1.55,
          color: 'var(--text-dim)',
          maxWidth: 640,
          margin: '0 0 28px',
        }}
      >
        Sendero is the agent layer for travel — quotes, approvals, bookings, refunds, and USDC
        settlement on Arc, all reconciled the moment the supplier confirms.
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono-x)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '4px 8px',
            border: '1px solid var(--ink)',
            color: 'var(--ink)',
          }}
        >
          Settled · USDC
        </div>
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--text)',
            fontFeatureSettings: "'ss05'",
          }}
        >
          tx 0x7a3f…c1a0
        </code>
      </div>
    </div>
  ),
};

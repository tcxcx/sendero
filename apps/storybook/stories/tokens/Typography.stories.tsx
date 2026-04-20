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
        {sizes.map((s) => (
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
        Labels, meter readouts, tx hashes. Ships with stylistic set 05 for
        humanist punctuation.
      </p>
      <div style={{ display: 'grid', gap: 20 }}>
        {monoSamples.map((s) => (
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

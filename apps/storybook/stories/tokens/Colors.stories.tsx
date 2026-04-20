import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * Visual token reference. Every swatch reads from the same CSS
 * variables the production app uses (via globals.css loaded in
 * preview.ts), so a change to the palette auto-updates here.
 */

type Swatch = { name: string; varName: string; note?: string };

function Grid({ swatches }: { swatches: Swatch[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
      }}
    >
      {swatches.map(s => (
        <div
          key={s.name}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 4,
            overflow: 'hidden',
            background: 'var(--bg-elev)',
          }}
        >
          <div
            style={{
              background: `var(${s.varName})`,
              height: 72,
              borderBottom: '1px solid var(--border)',
            }}
          />
          <div style={{ padding: 12 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--ink)',
              }}
            >
              {s.name}
            </div>
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-dim)',
              }}
            >
              {s.varName}
            </code>
            {s.note && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  marginTop: 4,
                }}
              >
                {s.note}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Colors',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

export const Vermilion: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Vermilion — Sendero's primary</h2>
      <p style={{ color: 'var(--text-dim)', maxWidth: 520 }}>
        Warmer than fintech blue, LATAM-adjacent without being literal. Reads on cream and on
        near-black.
      </p>
      <Grid
        swatches={[
          { name: 'Ink', varName: '--ink', note: 'Primary interactive' },
          { name: 'Ink Dim', varName: '--ink-dim', note: 'Hover wash' },
          { name: 'Ink Soft', varName: '--ink-soft', note: 'Selection bg' },
        ]}
      />
    </div>
  ),
};

export const Surfaces: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Surfaces</h2>
      <Grid
        swatches={[
          { name: 'Background', varName: '--bg', note: 'Cream page' },
          { name: 'Elevated', varName: '--bg-elev' },
          { name: 'Panel', varName: '--bg-panel' },
          { name: 'Sunk', varName: '--bg-sunk' },
        ]}
      />
    </div>
  ),
};

export const Accents: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Accents</h2>
      <Grid
        swatches={[
          { name: 'Green', varName: '--accent-green', note: 'Success, settle' },
          { name: 'Amber', varName: '--accent-amber', note: 'Caution' },
          { name: 'Rose', varName: '--accent-rose', note: 'Alert' },
        ]}
      />
    </div>
  ),
};

export const Tokens: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Stablecoins</h2>
      <Grid
        swatches={[
          { name: 'USDC', varName: '--usdc', note: 'Circle brand' },
          { name: 'EURC', varName: '--eurc' },
        ]}
      />
    </div>
  ),
};

export const Neutrals: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>Neutrals</h2>
      <Grid
        swatches={[
          { name: 'Text', varName: '--text' },
          { name: 'Text Dim', varName: '--text-dim' },
          { name: 'Text Faint', varName: '--text-faint' },
          { name: 'Border', varName: '--border' },
          { name: 'Border Strong', varName: '--border-strong' },
        ]}
      />
    </div>
  ),
};

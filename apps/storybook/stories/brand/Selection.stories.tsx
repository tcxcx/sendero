import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * Brand moment: the vermilion `::selection` style. Drag across the
 * paragraph to see the cream-on-ink highlight — one of Sendero's
 * editorial signatures, carried directly from globals.css.
 */
const meta: Meta = {
  title: 'Brand/Selection',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Drag to highlight. The `::selection` background is `var(--ink)` (vermilion) and the text is `#fafaf7` (cream). Defined once in `app/globals.css` and inherited by every Sendero surface.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;

export const Editorial: Story = {
  render: () => (
    <div
      style={{
        minHeight: '100dvh',
        padding: '80px 24px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--ink)',
        }}
      >
        Brand / selection
      </p>
      <h1
        style={{
          fontSize: 56,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          marginTop: 12,
        }}
      >
        Drag across this. Notice the <span style={{ color: 'var(--ink)' }}>vermilion</span>{' '}
        highlight pulling cream through the glyphs.
      </h1>
      <p style={{ fontSize: 18, color: 'var(--text-dim)', marginTop: 24 }}>
        Sendero's selection style is a single declaration in globals.css — but it's the moment that
        carries the brand the furthest. It shows up on every docs page, every code block, every chat
        transcript. Consistency is free; distinctiveness is what the moment does.
      </p>
      <pre
        style={{
          marginTop: 32,
          padding: 20,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {`::selection {
  background: var(--ink);   /* #fb542b */
  color: #fafaf7;           /* cream */
  text-shadow: none;
}`}
      </pre>
    </div>
  ),
};

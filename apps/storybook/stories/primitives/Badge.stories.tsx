import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * Badge — the small uppercase chip used for status labels
 * ("agent · active", "settled", "usdc · arc"). Mirrors the
 * `.cbar-active` / `.tag` patterns in globals.css.
 */
type Tone = 'ink' | 'green' | 'amber' | 'rose' | 'neutral';

export function Badge({
  tone = 'ink',
  solid = false,
  children,
}: {
  tone?: Tone;
  solid?: boolean;
  children: React.ReactNode;
}) {
  const color =
    tone === 'green'
      ? 'var(--accent-green)'
      : tone === 'amber'
        ? 'var(--accent-amber)'
        : tone === 'rose'
          ? 'var(--accent-rose)'
          : tone === 'neutral'
            ? 'var(--text-dim)'
            : 'var(--ink)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        border: `1px solid ${color}`,
        color: solid ? 'var(--bg)' : color,
        background: solid ? color : 'transparent',
        borderRadius: 2,
      }}
    >
      {children}
    </span>
  );
}

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { children: 'agent · active' },
  argTypes: {
    tone: { control: 'radio', options: ['ink', 'green', 'amber', 'rose', 'neutral'] },
    solid: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {};

export const Statuses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, padding: 16, flexWrap: 'wrap' }}>
      <Badge tone="ink">agent · active</Badge>
      <Badge tone="green">settled</Badge>
      <Badge tone="amber">holding</Badge>
      <Badge tone="rose">underfunded</Badge>
      <Badge tone="neutral">idle</Badge>
      <Badge tone="ink" solid>
        0.01 usdc
      </Badge>
      <Badge tone="green" solid>
        on-chain
      </Badge>
    </div>
  ),
};

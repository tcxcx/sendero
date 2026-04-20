import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * Tag — the `.tag` class family from globals.css, promoted to a
 * React component. Used for route chips ("MEX → SCL"), cabin class,
 * and tool names in the console.
 */

type Variant = 'default' | 'ink' | 'solid-ink' | 'usdc' | 'eurc';

export function Tag({
  variant = 'default',
  children,
}: {
  variant?: Variant;
  children: React.ReactNode;
}) {
  const styles: Record<Variant, React.CSSProperties> = {
    default: { color: 'var(--text-dim)', border: '1px solid var(--border)', background: 'transparent' },
    ink: { color: 'var(--ink)', border: '1px solid var(--ink)', background: 'transparent' },
    'solid-ink': { color: 'var(--bg-elev)', border: '1px solid var(--ink)', background: 'var(--ink)' },
    usdc: { color: 'var(--usdc)', border: '1px solid var(--usdc)', background: 'transparent' },
    eurc: { color: 'var(--eurc)', border: '1px solid var(--eurc)', background: 'transparent' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        borderRadius: 2,
        ...styles[variant],
      }}
    >
      {children}
    </span>
  );
}

const meta: Meta<typeof Tag> = {
  title: 'Primitives/Tag',
  component: Tag,
  args: { children: 'MEX → SCL' },
  argTypes: {
    variant: { control: 'radio', options: ['default', 'ink', 'solid-ink', 'usdc', 'eurc'] },
  },
};
export default meta;
type Story = StoryObj<typeof Tag>;

export const Default: Story = {};

export const Inventory: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 6, padding: 16, flexWrap: 'wrap' }}>
      <Tag>MEX → SCL</Tag>
      <Tag>2 pax</Tag>
      <Tag variant="ink">economy</Tag>
      <Tag variant="solid-ink">book_flight</Tag>
      <Tag variant="usdc">USDC</Tag>
      <Tag variant="eurc">EURC</Tag>
    </div>
  ),
};

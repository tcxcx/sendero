import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

/**
 * The Next.js app doesn't yet ship a `<Button>` primitive — buttons
 * are hand-rolled on inline styles. This story codifies the shape
 * the future `packages/ui` extraction should take: a thin React
 * wrapper over the vermilion CSS vars.
 */

type Variant = 'solid' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'solid',
  size = 'md',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  const pad = size === 'sm' ? '8px 14px' : size === 'lg' ? '16px 28px' : '12px 20px';
  const fs = size === 'sm' ? 11 : size === 'lg' ? 14 : 12;
  const styles: Record<Variant, React.CSSProperties> = {
    solid: { background: 'var(--ink)', color: '#fafaf7', border: '1.5px solid var(--ink)' },
    outline: { background: 'transparent', color: 'var(--ink)', border: '1.5px solid var(--ink)' },
    ghost: { background: 'transparent', color: 'var(--text)', border: '1.5px solid var(--border)' },
  };
  return (
    <button
      {...rest}
      style={{
        ...styles[variant],
        padding: pad,
        fontSize: fs,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderRadius: 4,
        cursor: 'pointer',
        ...rest.style,
      }}
    >
      {children}
    </button>
  );
}

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Settle split' },
  argTypes: {
    variant: { control: 'radio', options: ['solid', 'outline', 'ghost'] },
    size: { control: 'radio', options: ['sm', 'md', 'lg'] },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Solid: Story = { args: { variant: 'solid' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Ghost: Story = { args: { variant: 'ghost' } };

export const Gallery: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 16 }}>
      <Button variant="solid" size="sm">
        Small
      </Button>
      <Button variant="solid">Book flight</Button>
      <Button variant="solid" size="lg">
        Settle split
      </Button>
      <Button variant="outline">Quote FX</Button>
      <Button variant="ghost">Cancel</Button>
    </div>
  ),
};

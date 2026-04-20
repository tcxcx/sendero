import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';

// The shipping FooterRail lives in the monorepo root — we import
// via the Vite alias set in .storybook/main.ts. The component is a
// client component; since Storybook's renderer is client-only this
// Just Works.
import { FooterRail } from '@components/ui';
import { useSendero } from '@components/store';

/**
 * Fixture provider — seeds the zustand store so FooterRail has
 * something to render without spinning up the edge worker.
 */
function WithFixtures({ children }: { children: React.ReactNode }) {
  React.useLayoutEffect(() => {
    useSendero.setState({
      treasury: {
        treasuryAddress: '0x7a3f1c1a1b4e9d08ab23c9f1c1a1a027c9f1c1a0',
        balances: [
          { symbol: 'USDC', amount: '1847.3200', chain: 'arc' } as any,
          { symbol: 'EURC', amount: '412.0900', chain: 'arc' } as any,
        ],
        arc: { blockNumber: 184_203_771, gasPrice: '0.0000001' } as any,
      } as any,
      holdOrder: null,
      settlement: { phase: 'idle' } as any,
      onChainSettlement: null,
    } as any);
  }, []);
  return <>{children}</>;
}

const meta: Meta = {
  title: 'Composed/FooterRail',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "The persistent bottom rail. Shows treasury state, Arc block number, balance, and live meter totals. Imported as-is from `components/ui.tsx` — this story wraps it in a fixture-seeded provider rather than rewriting.",
      },
    },
  },
  decorators: [
    (Story) => (
      <WithFixtures>
        <div style={{ minHeight: 240, position: 'relative', padding: 24 }}>
          <Story />
        </div>
      </WithFixtures>
    ),
  ],
};
export default meta;
type Story = StoryObj;

export const Idle: Story = {
  render: () => <FooterRail />,
};

export const Settling: Story = {
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        useSendero.setState({ settlement: { phase: 'broadcasting' } } as any);
      }, []);
      return <Story />;
    },
  ],
  render: () => <FooterRail />,
};

export const Settled: Story = {
  decorators: [
    (Story) => {
      React.useLayoutEffect(() => {
        useSendero.setState({
          settlement: { phase: 'done' } as any,
          onChainSettlement: {
            txHash: '0x7a3f1c1a1b4e9d08ab23c9f1c1a1a027c9f1c1a0',
            blockNumber: 184_203_772,
          } as any,
        } as any);
      }, []);
      return <Story />;
    },
  ],
  render: () => <FooterRail />,
};

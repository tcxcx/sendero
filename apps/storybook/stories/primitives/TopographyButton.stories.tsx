import type { Meta, StoryObj } from '@storybook/react';

import { Button, TopographyButton } from '@sendero/ui/button';

// Inline arrow glyph so this story doesn't depend on lucide-react,
// which is an apps/app dependency, not a storybook one.
function ArrowRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className={className}>
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Sendero topography CTA. Outline at rest; on hover the vermilion
 * topography pattern fills in from the bottom-left while the label
 * gets a "selection rectangle" treatment in white-on-ink. Inspired by
 * the marketing hero text-selection pattern; reused for the dashboard
 * "Open agent console" button.
 */
const meta: Meta<typeof TopographyButton> = {
  title: 'Primitives/Buttons/Topography',
  component: TopographyButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Pair the `topography` `Button` variant with two child spans (the bg layer + the label), or use the `TopographyButton` wrapper which renders them for you.',
      },
    },
  },
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof TopographyButton>;

export const Default: Story = {
  render: () => (
    <TopographyButton>
      Open agent console
      <ArrowRight className="size-4" aria-hidden="true" />
    </TopographyButton>
  ),
};

export const Outline: Story = {
  name: 'As <Button variant="topography">',
  render: () => (
    <Button variant="topography">
      <span className="agent-console-cta__bg" aria-hidden="true" />
      <span className="agent-console-cta__label">
        Open agent console
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Button>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <TopographyButton size="sm">
        Small
        <ArrowRight className="size-4" aria-hidden="true" />
      </TopographyButton>
      <TopographyButton>
        Default
        <ArrowRight className="size-4" aria-hidden="true" />
      </TopographyButton>
      <TopographyButton size="lg">
        Large
        <ArrowRight className="size-4" aria-hidden="true" />
      </TopographyButton>
    </div>
  ),
};

export const InContext: Story = {
  name: 'Page-header CTA pair',
  render: () => (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: 24,
        background: 'var(--surface-raised, #E8DFD2)',
      }}
    >
      <TopographyButton>
        Open agent console
        <ArrowRight className="size-4" aria-hidden="true" />
      </TopographyButton>
      <Button>
        Create prepaid trip
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  ),
};

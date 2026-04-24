import * as React from 'react';

import { senderoBrand } from '@sendero/ui/brand';
import { AnimatedNumber } from '@sendero/ui/animated-number';
import { AgentCard } from '@sendero/ui/agent-card';
import { FeatureGrid } from '@sendero/ui/feature-grid';
import {
  FilterPillGroup,
  FilterDropdown,
  FilterDateRange,
  FilterSearch,
} from '@sendero/ui/filter-pill-group';
import { UnderlineTabs } from '@sendero/ui/underline-tabs';
import {
  BarCluster,
  BinocularField,
  BouncingPath,
  ConnectedNodes,
  DotGridFrame,
  Fanout,
  PeakedLine,
  RouteCurve,
} from '@sendero/ui/illustrations/dot-grid';
import type { Meta, StoryObj } from '@storybook/react';

/**
 * Editorial pass v2 — the new surface/shadow/hairline/numeral system
 * and the components that consume it. Borrows patterns from
 * usehandle.ai but stays on Sendero's warm parchment palette.
 */
const meta: Meta = {
  title: 'Brand/Editorial System',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'DESIGN.md §7 / §9 / §13 / §19 — surface tiers, shadow scale, tint + hairline tokens, editorial numerals, dotted-grid illustrations, and the components that put them to use.',
      },
    },
  },
};

export default meta;

type Story = StoryObj;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--surface-base)',
        padding: '48px 40px',
        borderBottom: 'var(--hairline-soft)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--label-meta)',
          letterSpacing: 'var(--label-meta-tracking)',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
          color: 'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
          marginBottom: 24,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export const SurfaceTiers: Story = {
  render: () => (
    <Panel title="Surface tiers (§7)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
        {(
          [
            ['Base', senderoBrand.surfaces.base.hex, 'none'],
            ['Raised', senderoBrand.surfaces.raised.hex, 'var(--shadow-md)'],
            ['Floating', senderoBrand.surfaces.floating.hex, 'var(--shadow-lg)'],
            ['Terminal', 'rgba(31,42,68,0.97)', 'var(--shadow-terminal)'],
          ] as const
        ).map(([label, bg, shadow]) => (
          <div
            key={label}
            style={{
              background: bg,
              color: label === 'Terminal' ? '#f2ecdc' : 'inherit',
              padding: '32px 24px',
              borderRadius: 'var(--radius-lg)',
              boxShadow: shadow,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>{bg}</div>
          </div>
        ))}
      </div>
    </Panel>
  ),
};

export const ShadowScale: Story = {
  render: () => (
    <Panel title="Shadow scale (§7)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20 }}>
        {(['xs', 'sm', 'md', 'lg', 'xl', 'terminal'] as const).map(key => (
          <div
            key={key}
            style={{
              background:
                key === 'terminal' ? 'rgba(31,42,68,0.97)' : 'var(--surface-raised)',
              color: key === 'terminal' ? '#f2ecdc' : 'inherit',
              height: 120,
              borderRadius: 'var(--radius-lg)',
              boxShadow: `var(--shadow-${key})`,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {key}
          </div>
        ))}
      </div>
    </Panel>
  ),
};

export const TintsAndHairlines: Story = {
  render: () => (
    <Panel title="Tints + Hairlines (§9)">
      <div style={{ display: 'grid', gap: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          {Object.entries(senderoBrand.tints).map(([name, value]) => (
            <div
              key={name}
              style={{
                background: value as string,
                height: 64,
                borderRadius: 'var(--radius-sm)',
                display: 'grid',
                placeItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              {name}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {(
            [
              ['Hairline', 'var(--hairline)'],
              ['Soft', 'var(--hairline-soft)'],
              ['Strong', 'var(--hairline-strong)'],
            ] as const
          ).map(([label, rule]) => (
            <div key={label} style={{ padding: '24px 0', borderTop: rule }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--label-meta-tracking)',
                  color:
                    'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  ),
};

export const Numerals: Story = {
  render: () => (
    <Panel title="Editorial numerals + AnimatedNumber (§13.1)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 40 }}>
        {(
          [
            ['Active trips', 47, undefined, 0, 'var(--numeral-xl)'],
            ['Invoiced', 128500, '$', 0, 'var(--numeral-lg)'],
            ['Avg take rate', 3.25, undefined, 2, 'var(--numeral-md)'],
          ] as const
        ).map(([label, value, prefix, precision, size]) => (
          <div key={label}>
            <div
              style={{
                fontSize: size,
                fontWeight: 600,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <AnimatedNumber value={value} prefix={prefix} precision={precision} />
              {label === 'Avg take rate' ? <span aria-hidden>&nbsp;%</span> : null}
            </div>
            <div
              style={{
                marginTop: 16,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--label-meta)',
                letterSpacing: 'var(--label-meta-tracking)',
                textTransform: 'uppercase',
                color:
                  'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  ),
};

export const DottedGridIllustrations: Story = {
  render: () => {
    const items = [
      { Node: RouteCurve, name: 'Route curve' },
      { Node: BarCluster, name: 'Bar cluster' },
      { Node: PeakedLine, name: 'Peaked line' },
      { Node: Fanout, name: 'Fanout' },
      { Node: BouncingPath, name: 'Bouncing path' },
      { Node: ConnectedNodes, name: 'Connected nodes' },
      { Node: BinocularField, name: 'Binocular field' },
    ];
    return (
      <Panel title="Dotted-grid illustrations (§19)">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {items.map(({ Node, name }) => (
            <div key={name}>
              <DotGridFrame interactive>
                <Node draw="mount" />
              </DotGridFrame>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--label-meta)',
                  letterSpacing: 'var(--label-meta-tracking)',
                  textTransform: 'uppercase',
                  color:
                    'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
                }}
              >
                {name}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    );
  },
};

export const Tabs: Story = {
  render: () => {
    type PillValue = 'pending' | 'paid' | 'rejected';
    type UnderlineValue = 'overview' | 'activity' | 'settings';
    const [pillValue] = React.useState<PillValue>('pending');
    const [underlineValue, setUnderlineValue] = React.useState<UnderlineValue>('overview');
    return (
      <Panel title="Tabs — UnderlineTabs">
        <div style={{ display: 'grid', gap: 40 }}>
          <UnderlineTabs<UnderlineValue>
            value={underlineValue}
            onChange={setUnderlineValue}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'activity', label: 'Activity' },
              { value: 'settings', label: 'Settings' },
            ]}
          />
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'color-mix(in oklab, var(--sendero-midnight, #1f2a44) 60%, transparent)',
            }}
          >
            active: {pillValue} · {underlineValue}
          </div>
        </div>
      </Panel>
    );
  },
};

export const Filters: Story = {
  render: () => (
    <Panel title="FilterPillGroup (§19)">
      <FilterPillGroup
        search={<FilterSearch placeholder="Search trips, invoices…" containerClassName="w-[280px]" />}
      >
        <FilterDropdown label="All statuses" />
        <FilterDropdown label="All types" />
        <FilterDateRange label="Apr 1 – Apr 30" />
        <FilterDropdown label="All brokers" />
      </FilterPillGroup>
    </Panel>
  ),
};

export const AgentCards: Story = {
  render: () => (
    <Panel title="AgentCard gallery (§19)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
        <AgentCard
          illustration={<BinocularField draw="mount" />}
          status="live"
          title="Booking agent"
          description="Search Duffel inventory, check policy, reserve escrow, hold, confirm, settle — all in one durable workflow."
          cta="Open agent"
          primaryAction
        />
        <AgentCard
          illustration={<RouteCurve draw="mount" />}
          status="beta"
          title="Trip companion"
          description="Assists travelers post-book through check-in, disruption, and arrival — across WhatsApp, Slack, email, web."
          cta="Open agent"
        />
        <AgentCard
          illustration={<Fanout draw="mount" />}
          status="coming_soon"
          title="Commission split"
          description="Atomic on-chain fan-out across supplier, agency, rail, validator, and reputation tip in one Arc userOp."
        />
      </div>
    </Panel>
  ),
};

export const Features: Story = {
  render: () => (
    <Panel title="FeatureGrid (§19)">
      <FeatureGrid
        cells={[
          {
            illustration: (
              <DotGridFrame>
                <RouteCurve draw="intersection" />
              </DotGridFrame>
            ),
            title: 'Route intelligence',
            description:
              'Every booking lives as an itinerary, not a row. Scope changes reroute the plan without losing the thread.',
          },
          {
            illustration: (
              <DotGridFrame>
                <BarCluster draw="intersection" delayMs={80} />
              </DotGridFrame>
            ),
            title: 'Policy gates',
            description:
              'Tenant policy is a tool-gated step, not a prompt instruction. The agent cannot skip it.',
          },
          {
            illustration: (
              <DotGridFrame>
                <Fanout draw="intersection" delayMs={160} />
              </DotGridFrame>
            ),
            title: 'Atomic settlement',
            description:
              'Supplier, agency, fee, validator, and tip fan out in a single Arc userOp. Card rails can’t do this.',
          },
          {
            illustration: (
              <DotGridFrame>
                <BinocularField draw="intersection" delayMs={240} />
              </DotGridFrame>
            ),
            title: 'Map-room voice',
            description:
              'Editorial, unhurried, explorer-calm. Sendero reads like a trusted travel guide with taste.',
          },
        ]}
      />
    </Panel>
  ),
};

'use client';

/**
 * Left-rail trip list for the MetaInbox console.
 *
 * Mirrors `/sendero/project/route-artboards.jsx::MetaInbox` left
 * column. Each row carries: channel icon + traveler name + timestamp
 * + tripId · route + last-message tail + state pill. The active row
 * gets a 2px vermillion edge stripe to its left, keyed on the
 * design's "active = surface-floating + shadow-sm" pattern.
 */

import Link from 'next/link';

import { asChannelKey, CHANNELS } from './channels';

export type TripState = 'AWAITING' | 'HOLD' | 'SETTLED' | 'OVER CAP' | 'SEARCH';

export interface TripRowData {
  id: string;
  who: string;
  route: string;
  state: TripState;
  /** Tone family — drives the state pill colour. */
  tone: 'verm' | 'sand' | 'sea' | 'outline';
  /** Short timestamp like "14:02" or "Yesterday". */
  mins: string;
  /** Last-message preview (single-line, truncated). */
  body: string;
  channel: string;
}

interface TripRailProps {
  trips: TripRowData[];
  activeTripId: string | null;
  /** When set, only the focused trip renders (deep-link / scoped). */
  scopedTripId?: string | null;
  /** When set, the channel-scope card replaces the tab+search header. */
  scopedChannel?: ReturnType<typeof CHANNELS extends Record<string, infer V> ? () => V : never>;
}

export function TripRail({ trips, activeTripId, scopedTripId, scopedChannel }: TripRailProps) {
  const visible = scopedTripId ? trips.filter(t => t.id === scopedTripId) : trips;
  return (
    <div
      style={{
        borderRight: '1px solid var(--hairline-color)',
        paddingRight: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {scopedChannel ? (
        <div
          className="sd-card-flat"
          style={{
            boxShadow: `inset 0 0 0 1px ${scopedChannel.accent}`,
            padding: '10px 12px',
            background: scopedChannel.tint,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {scopedChannel.icon(12)}
            <span className="t-meta" style={{ color: scopedChannel.accent }}>
              Channel scope
            </span>
          </div>
          <div
            className="t-mono"
            style={{ marginTop: 4, color: scopedChannel.accent, fontSize: 11 }}
          >
            {scopedChannel.handle}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="sd-pill sd-pill-verm" style={{ fontSize: 10 }}>
              Awaiting · {trips.filter(t => t.state === 'AWAITING').length}
            </span>
            <span className="sd-pill sd-pill-sand" style={{ fontSize: 10 }}>
              Holds · {trips.filter(t => t.state === 'HOLD').length}
            </span>
            <span className="sd-pill sd-pill-sea" style={{ fontSize: 10 }}>
              Settled · {trips.filter(t => t.state === 'SETTLED').length}
            </span>
          </div>
          <div
            className="sd-card-flat"
            style={{
              boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(253,251,247,0.7)',
            }}
          >
            <span className="t-mono ink-60">⌘K</span>
            <span className="t-body ink-60">Search trips, mention @trp-…</span>
          </div>
        </>
      )}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {visible.map(t => {
          const active = t.id === activeTripId;
          const tc = CHANNELS[asChannelKey(t.channel)];
          return (
            <Link
              key={t.id}
              href={`/dashboard/console?tripId=${t.id}`}
              style={{
                padding: '12px 12px',
                borderRadius: 10,
                background: active ? 'rgba(253,251,247,0.95)' : 'transparent',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
                marginBottom: 4,
                cursor: 'pointer',
                position: 'relative',
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
              }}
            >
              {active ? (
                <div
                  style={{
                    position: 'absolute',
                    left: -18,
                    top: 14,
                    bottom: 14,
                    width: 2,
                    background: 'var(--vermillion)',
                  }}
                />
              ) : null}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {tc.icon(11)}
                  <span className="t-body" style={{ fontWeight: 500, fontSize: 13 }}>
                    {t.who}
                  </span>
                </span>
                <span className="t-mono ink-60" style={{ fontSize: 11 }}>
                  {t.mins}
                </span>
              </div>
              <div className="t-mono ink-60" style={{ marginTop: 2, fontSize: 11 }}>
                {t.id} · {t.route}
              </div>
              <div
                className="t-body ink-70"
                style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45 }}
              >
                {t.body}
              </div>
              <div style={{ marginTop: 6 }}>
                <StateChip state={t.state} tone={t.tone} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StateChip({ state, tone }: { state: TripState; tone: TripRowData['tone'] }) {
  return (
    <span
      className={`sd-pill sd-pill-${tone}`}
      style={{ fontSize: 9, padding: '2px 7px', fontWeight: 600, letterSpacing: '0.06em' }}
    >
      {state}
    </span>
  );
}

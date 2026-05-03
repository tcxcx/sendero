/**
 * Boarding-pass Satori card.
 *
 * Rendered as a 1200×630 PNG and sent to the traveler via
 * `send_image_message` immediately after `BOOKING_CONFIRMED` lands.
 * Mirrors the brand palette from `share-card.tsx` so the boarding-pass,
 * NFT stamp, agent OGs, and share cards all sit in the same visual
 * family.
 *
 * Layout (top-down):
 *   1. Eyebrow: vermillion bar + "Sendero × Travel Agent" kicker
 *   2. Big route block: ORIGIN → DESTINATION (large display weight)
 *   3. Date + time-of-departure under the route
 *   4. Two-column grid: Passenger / PNR / Cabin / Total USDC / On-chain proof
 *   5. Footer: airline + flight # + Sendero domain hint
 *   6. Right-edge dashed perforation (boarding-pass tear-line motif)
 */

import type { ReactElement } from 'react';

export const BOARDING_PASS_CARD_SIZE = { width: 1200, height: 630 } as const;

const BRAND = {
  vermillion: '#D65438',
  midnight: '#1F2A44',
  sea: '#0F7C82',
  parchment: '#EEDCC7',
  parchmentLight: '#F7EFE4',
  hairline: '#D8C1A7',
  ink: '#2A2A2A',
} as const;

const TITLE_HARD_CAP = 28;
const META_HARD_CAP = 36;

export interface BoardingPassCardProps {
  /** Origin IATA + city, e.g. "EZE · Buenos Aires". */
  origin: string;
  /** Destination IATA + city, e.g. "LIM · Lima". */
  destination: string;
  /** Date string already formatted, e.g. "May 6, 2026". */
  departureDate: string;
  /** Local departure time, e.g. "03:52". */
  departureTime: string;
  /** Local arrival time, e.g. "06:39". */
  arrivalTime?: string;
  /** Passenger display name. */
  passengerName: string;
  /** Duffel order locator / Sendero PNR. */
  pnr: string;
  /** Cabin label (Economy / Business / First). */
  cabin?: string;
  /** Total in USDC. */
  totalUsdc: string;
  /** On-chain settlement tx hash. Truncated for display. */
  settlementTxHash?: string;
  /** Carrier name + flight number, e.g. "Duffel Airways · DA431". */
  carrier: string;
  /** Optional kicker, defaults to "Sendero × Travel Agent". */
  kicker?: string;
}

function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function shortHash(hash: string | undefined): string {
  if (!hash) return '—';
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function BoardingPassCard(props: BoardingPassCardProps): ReactElement {
  const kicker = (props.kicker ?? 'Sendero × Travel Agent').toUpperCase();
  const origin = clip(props.origin, TITLE_HARD_CAP);
  const destination = clip(props.destination, TITLE_HARD_CAP);
  const passengerName = clip(props.passengerName, META_HARD_CAP);
  const carrier = clip(props.carrier, META_HARD_CAP);

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: BRAND.parchment,
        fontFamily: 'sans-serif',
        color: BRAND.midnight,
      }}
    >
      {/* Left two-thirds — main boarding pass content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '56px 64px',
          borderRight: `2px dashed ${BRAND.vermillion}`,
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 28,
          }}
        >
          <div style={{ width: 12, height: 12, background: BRAND.vermillion }} />
          <span
            style={{
              fontSize: 16,
              letterSpacing: 4,
              color: BRAND.midnight,
              fontWeight: 700,
            }}
          >
            {kicker}
          </span>
        </div>

        {/* Route */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 24,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {origin}
          </span>
          <span
            style={{
              fontSize: 60,
              color: BRAND.vermillion,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            →
          </span>
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {destination}
          </span>
        </div>

        {/* Date + departure time */}
        <div
          style={{
            display: 'flex',
            gap: 24,
            fontSize: 24,
            color: BRAND.ink,
            marginBottom: 40,
          }}
        >
          <span>{props.departureDate}</span>
          <span style={{ color: BRAND.hairline }}>·</span>
          <span style={{ fontWeight: 600 }}>
            {props.departureTime}
            {props.arrivalTime ? ` → ${props.arrivalTime}` : ''}
          </span>
        </div>

        {/* Meta grid: passenger, PNR, cabin, total */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <MetaRow label="Passenger" value={passengerName} />
          <MetaRow label="PNR" value={props.pnr} mono />
          {props.cabin ? <MetaRow label="Cabin" value={props.cabin} /> : null}
          <MetaRow label="Total" value={`${props.totalUsdc} USDC`} accent />
          {props.settlementTxHash ? (
            <MetaRow label="On-chain proof" value={shortHash(props.settlementTxHash)} mono />
          ) : null}
        </div>

        {/* Footer: carrier */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'space-between',
            color: BRAND.ink,
            fontSize: 18,
          }}
        >
          <span>{carrier}</span>
          <span style={{ color: BRAND.hairline }}>sendero.travel</span>
        </div>
      </div>

      {/* Right stub — vertical brand band with rotated PNR */}
      <div
        style={{
          width: 280,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND.midnight,
          color: BRAND.parchmentLight,
          padding: '40px 24px',
        }}
      >
        <div
          style={{
            transform: 'rotate(90deg)',
            transformOrigin: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontSize: 14,
              letterSpacing: 6,
              color: BRAND.vermillion,
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            Boarding Pass
          </span>
          <span
            style={{
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: 4,
              fontFamily: 'monospace',
            }}
          >
            {props.pnr}
          </span>
          <span
            style={{
              fontSize: 14,
              letterSpacing: 4,
              color: BRAND.parchmentLight,
              opacity: 0.7,
              textTransform: 'uppercase',
            }}
          >
            Arc · Testnet
          </span>
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 16,
      }}
    >
      <span
        style={{
          fontSize: 13,
          letterSpacing: 2.5,
          color: BRAND.ink,
          opacity: 0.55,
          textTransform: 'uppercase',
          minWidth: 180,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: accent ? 30 : 22,
          fontWeight: accent ? 800 : 600,
          color: accent ? BRAND.vermillion : BRAND.midnight,
          fontFamily: mono ? 'monospace' : 'sans-serif',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * TripStepper — six-step trip lifecycle from
 * `route-artboards.jsx::TripsDetailA`. Steps: Intake → Search → Review
 * → Hold → Pay → Settle.  Current step is derived from `trip.status`;
 * earlier steps render with a sea pill, the active step in vermillion,
 * later steps as outlined ghosts.  Failed/canceled trips render every
 * step in sand.
 */

import type { CSSProperties } from 'react';

const STEPS = ['Intake', 'Search', 'Review', 'Hold', 'Pay', 'Settle'] as const;
type Step = (typeof STEPS)[number];

export function TripStepper({ status }: { status: string }) {
  const { currentIndex, abandoned } = stepStateFromStatus(status);

  return (
    <div
      className="sd-card-raised"
      style={{
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div className="t-meta">Stepper</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {STEPS.map((step, i) => {
          const tone = abandoned
            ? 'sand'
            : i < currentIndex
              ? 'sea'
              : i === currentIndex
                ? 'verm'
                : 'outline';
          const done = !abandoned && i < currentIndex;
          return (
            <ChunkRow
              key={step}
              step={step}
              tone={tone}
              done={done}
              isLast={i === STEPS.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChunkRow({
  step,
  tone,
  done,
  isLast,
}: {
  step: Step;
  tone: 'verm' | 'sand' | 'sea' | 'outline';
  done: boolean;
  isLast: boolean;
}) {
  const pillStyle: CSSProperties = {
    padding: '5px 12px',
    fontSize: 11,
    fontFamily: 'var(--font-mono-x)',
    letterSpacing: '0.06em',
    fontWeight: 600,
  };
  return (
    <>
      <span className={`sd-pill sd-pill-${tone}`} style={pillStyle}>
        {done ? '✓ ' : ''}
        {step}
      </span>
      {isLast ? null : (
        <div
          aria-hidden
          style={{ flex: 1, minWidth: 12, height: 1, background: 'var(--hairline-color)' }}
        />
      )}
    </>
  );
}

function stepStateFromStatus(status: string): { currentIndex: number; abandoned: boolean } {
  switch (status) {
    case 'draft':
      return { currentIndex: 0, abandoned: false };
    case 'searching':
      return { currentIndex: 1, abandoned: false };
    case 'awaiting_approval':
      return { currentIndex: 2, abandoned: false };
    case 'booked':
      return { currentIndex: 3, abandoned: false };
    case 'in_progress':
      return { currentIndex: 4, abandoned: false };
    case 'completed':
      return { currentIndex: 5, abandoned: false };
    case 'failed':
    case 'canceled':
      return { currentIndex: -1, abandoned: true };
    default:
      return { currentIndex: 0, abandoned: false };
  }
}

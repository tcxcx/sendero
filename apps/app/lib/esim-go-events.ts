/**
 * Normalize eSIM Go usage callback payloads onto Sendero's lifecycle
 * vocabulary.
 *
 * Per v2.5 docs (https://docs.esim-go.com/api/v2_5/operations/your-usage-callback-url/post/),
 * the only documented `alertType` is `Utilisation`. The lifecycle
 * Sendero exposes (ready / active / expiring / expired) is therefore
 * derived from the bundle's quantity ratio + `endTime` clock, not
 * from a provider event-name dispatch.
 *
 * Quantities are in BYTES — `initialQuantity: 20000000000` is 20 GB.
 * `usageMb` on Sendero's `Esim` row stores MB; we convert here.
 *
 * V3 callback payload (with HMAC) carries `bundle.id`, `bundle.reference`,
 * `bundle.description`, `bundle.unlimited`. V2 omits those. We tolerate
 * both shapes and persist what's present in `metadata.events` for audit.
 */

import type { Esim } from '@sendero/database';

export type EsimLifecycleEvent = 'ready' | 'active' | 'expiring' | 'expired';

export interface NormalizedEsimEvent {
  iccid: string;
  alertType: 'Utilisation';
  /** Lifecycle bucket Sendero exposes — derived from quantity + endTime. */
  event: EsimLifecycleEvent;
  /** Cumulative MB used on this bundle (initial − remaining). 0 when fresh. */
  usageMb: number;
  /** Total MB the bundle was sized at. */
  initialMb: number;
  /** Bundle endTime as Date for downstream Esim.expiresAt updates. */
  endTime: Date;
  /** True when the bundle is unlimited (V3 only; defaults to false). */
  unlimited: boolean;
  /** Free-form raw body — persisted on `Esim.metadata.events` for audit. */
  raw: Record<string, unknown>;
}

const BYTES_PER_MB = 1024 * 1024;

function bytesToMb(n: number): number {
  return Math.round(n / BYTES_PER_MB);
}

/**
 * Derive Sendero's lifecycle bucket from the raw quantities + clock.
 *
 *   - `expired`  — endTime <= now (bundle window closed).
 *   - `expiring` — usage at 80%+ OR <24h to endTime.
 *   - `active`   — bundle has been touched (remaining < initial).
 *   - `ready`    — bundle present, untouched (remaining == initial).
 *
 * Order matters: an expired bundle reads `endTime <= now` regardless of
 * remaining quantity (provider may keep sending late callbacks); a
 * still-active bundle near 100% used is `expiring`, not `expired`.
 */
function deriveLifecycle(args: {
  initialBytes: number;
  remainingBytes: number;
  endTime: Date;
  now: Date;
  unlimited: boolean;
}): EsimLifecycleEvent {
  const { initialBytes, remainingBytes, endTime, now, unlimited } = args;
  if (endTime.getTime() <= now.getTime()) return 'expired';
  const dayMs = 24 * 60 * 60 * 1000;
  if (endTime.getTime() - now.getTime() < dayMs) return 'expiring';
  if (unlimited) return 'active'; // unlimited bundles: ratio doesn't apply.
  if (initialBytes <= 0) return 'active';
  const usedRatio = (initialBytes - remainingBytes) / initialBytes;
  if (usedRatio >= 0.8) return 'expiring';
  if (usedRatio > 0) return 'active';
  return 'ready';
}

export function normalizeEsimGoEvent(
  payload: unknown,
  now: Date = new Date()
): NormalizedEsimEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.alertType !== 'Utilisation') return null;
  const iccid = typeof p.iccid === 'string' ? p.iccid : null;
  if (!iccid) return null;
  const bundle = p.bundle as Record<string, unknown> | undefined;
  if (!bundle) return null;
  const initialBytes = typeof bundle.initialQuantity === 'number' ? bundle.initialQuantity : null;
  const remainingBytes =
    typeof bundle.remainingQuantity === 'number' ? bundle.remainingQuantity : null;
  const endTimeStr = typeof bundle.endTime === 'string' ? bundle.endTime : null;
  if (initialBytes === null || remainingBytes === null || !endTimeStr) return null;
  const endTime = new Date(endTimeStr);
  if (Number.isNaN(endTime.getTime())) return null;
  const unlimited = bundle.unlimited === true;

  const usedBytes = Math.max(0, initialBytes - remainingBytes);
  const event = deriveLifecycle({ initialBytes, remainingBytes, endTime, now, unlimited });

  return {
    iccid,
    alertType: 'Utilisation',
    event,
    usageMb: bytesToMb(usedBytes),
    initialMb: bytesToMb(initialBytes),
    endTime,
    unlimited,
    raw: p,
  };
}

/** Compute the `Esim` row update for a normalized event. */
export function applyEventToEsim(
  esim: Pick<Esim, 'status' | 'usageMb' | 'metadata' | 'expiresAt'>,
  evt: NormalizedEsimEvent
): {
  status: string;
  usageMb: number;
  expiresAt: Date;
  activatedAt?: Date;
  metadata: Record<string, unknown>;
} {
  const merged: Record<string, unknown> = {
    ...((esim.metadata as Record<string, unknown> | null) ?? {}),
  };
  const events = Array.isArray(merged.events) ? (merged.events as unknown[]) : [];
  events.push({
    at: new Date().toISOString(),
    event: evt.event,
    usageMb: evt.usageMb,
    raw: evt.raw,
  });
  merged.events = events;

  const next = {
    status: evt.event,
    // Provider's bytes are authoritative — first callback after install
    // resets our cached counter to the real number. Don't take max() here
    // (a topup that resets remaining-back-to-initial would otherwise be
    // undercounted).
    usageMb: evt.usageMb,
    expiresAt: evt.endTime,
    metadata: merged,
  } as ReturnType<typeof applyEventToEsim>;

  // First time we see usage > 0, stamp activatedAt so the audit log
  // shows "first data flowed at <time>". Subsequent callbacks leave it
  // alone (handled by caller via row.activatedAt presence check).
  if (evt.event === 'active' && evt.usageMb > 0) {
    next.activatedAt = new Date();
  }
  return next;
}

/**
 * Traveler preference learning loop.
 *
 * Every approval / rejection / selection feeds a rolling signal per
 * (traveler, category). Once we've seen N observations and the ratio is
 * above a confidence threshold, the agent can suggest auto-applying the
 * preference on future trips.
 *
 * Storage-agnostic: caller supplies a PreferenceStore. Adapted from
 * desk-v1's `preferences.ts` + `team-preferences.ts`.
 */

export type PreferenceCategory =
  | 'seat'
  | 'cabin_class'
  | 'carrier'
  | 'meal'
  | 'hotel_chain'
  | 'hotel_room_type'
  | 'bag_allowance'
  | 'layover_tolerance'
  | 'departure_time'
  | 'price_ceiling';

export type PreferenceSignal = 'approve' | 'reject' | 'select' | 'skip';

export interface PreferenceLog {
  id: string;
  tenantId: string;
  subjectId: string;
  category: PreferenceCategory;
  key: string; // e.g. "window", "premium_economy", "BA", "16:00-21:00"
  signal: PreferenceSignal;
  amountUsd?: number | null;
  context?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PreferenceStore {
  log: (entry: Omit<PreferenceLog, 'id' | 'createdAt'>) => Promise<PreferenceLog>;
  listForSubject: (args: {
    tenantId: string;
    subjectId: string;
    category?: PreferenceCategory;
    since?: Date;
    limit?: number;
  }) => Promise<PreferenceLog[]>;
}

export interface PreferencePattern {
  category: PreferenceCategory;
  key: string;
  totalObservations: number;
  positiveRatio: number; // approvals+selects / total
  avgAmountUsd: number | null;
  lastSeenAt: Date | null;
}

const MIN_OBSERVATIONS = 3;
const HIGH_CONFIDENCE = 0.8;

/**
 * Aggregate raw logs into patterns, one per (category, key). Approve +
 * select count as positive; reject + skip count as negative.
 */
export function aggregatePreferences(logs: PreferenceLog[]): PreferencePattern[] {
  const buckets = new Map<string, PreferenceLog[]>();
  for (const log of logs) {
    const bucketKey = `${log.category}::${log.key}`;
    const existing = buckets.get(bucketKey) ?? [];
    existing.push(log);
    buckets.set(bucketKey, existing);
  }

  const patterns: PreferencePattern[] = [];
  for (const [, items] of buckets) {
    if (items.length === 0) continue;
    const positives = items.filter(i => i.signal === 'approve' || i.signal === 'select').length;
    const amounts = items.map(i => i.amountUsd).filter((a): a is number => a != null);
    const lastSeen = items.reduce<Date | null>(
      (acc, i) => (acc && acc > i.createdAt ? acc : i.createdAt),
      null
    );
    patterns.push({
      category: items[0].category,
      key: items[0].key,
      totalObservations: items.length,
      positiveRatio: positives / items.length,
      avgAmountUsd:
        amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : null,
      lastSeenAt: lastSeen,
    });
  }

  return patterns.sort((a, b) => b.totalObservations - a.totalObservations);
}

/**
 * Returns the set of patterns confident enough to auto-apply on the next
 * trip — e.g. {seat: "window"} with 0.9 positive ratio over 5 observations.
 */
export function suggestAutoApply(
  patterns: PreferencePattern[],
  opts: { minObservations?: number; minRatio?: number } = {}
): PreferencePattern[] {
  const minObservations = opts.minObservations ?? MIN_OBSERVATIONS;
  const minRatio = opts.minRatio ?? HIGH_CONFIDENCE;
  return patterns.filter(
    p => p.totalObservations >= minObservations && p.positiveRatio >= minRatio
  );
}

/** Render preferences as a prompt block for the booking agent. */
export function renderPreferencesPrompt(patterns: PreferencePattern[]): string {
  const applied = suggestAutoApply(patterns);
  if (applied.length === 0) return '';
  return [
    '## Traveler preferences (learned)',
    ...applied.map(
      p =>
        `- ${p.category} = \`${p.key}\` (${(p.positiveRatio * 100).toFixed(0)}% over ${p.totalObservations} trips)`
    ),
  ].join('\n');
}

/**
 * Record a single decision, then return the updated pattern for that
 * category so the caller can show "learned your preference" UI.
 */
export async function recordDecision(
  store: PreferenceStore,
  entry: Omit<PreferenceLog, 'id' | 'createdAt'>
): Promise<PreferencePattern | null> {
  await store.log(entry);
  const logs = await store.listForSubject({
    tenantId: entry.tenantId,
    subjectId: entry.subjectId,
    category: entry.category,
    limit: 50,
  });
  const patterns = aggregatePreferences(logs);
  return patterns.find(p => p.key === entry.key) ?? null;
}

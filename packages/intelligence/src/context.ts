/**
 * Build the full agent context to inject into an LLM system prompt.
 * Composes:
 *   - Locale slice (from @sendero/locale)
 *   - Traveler preferences (learned patterns)
 *   - Recalled memories (tenant + subject scoped)
 *   - Active trip state (optional, passed in by caller)
 *
 * Called at the start of every chat turn / WhatsApp inbound / Slack
 * mention. Kept framework-agnostic so apps/app and apps/edge share.
 */

import { renderLocaleSlicePrompt, type CompactLocaleSlice } from '@sendero/locale';
import { renderMemoriesPrompt } from './memory';
import { renderPreferencesPrompt } from './preferences';
import type { MemoryHit } from './types';
import type { PreferencePattern } from './preferences';

export interface TripStateSnapshot {
  tripId: string;
  route: string;
  departAt: string;
  status: 'planning' | 'held' | 'booked' | 'in_progress' | 'completed';
  pnr?: string | null;
  bookingRef?: string | null;
}

export interface BuildAgentContextArgs {
  localeSlice: CompactLocaleSlice;
  preferences?: PreferencePattern[];
  memories?: MemoryHit[];
  trip?: TripStateSnapshot | null;
  /** Optional extra lines the caller wants appended (flight-search results, etc.). */
  extra?: string[];
}

export function buildAgentContext(args: BuildAgentContextArgs): string {
  const blocks: string[] = [];

  blocks.push(renderLocaleSlicePrompt(args.localeSlice));

  const prefsBlock = renderPreferencesPrompt(args.preferences ?? []);
  if (prefsBlock) blocks.push(prefsBlock);

  const memBlock = renderMemoriesPrompt(args.memories ?? []);
  if (memBlock) blocks.push(memBlock);

  if (args.trip) {
    blocks.push(
      [
        `## Active trip`,
        `- Trip: \`${args.trip.tripId}\` (${args.trip.status})`,
        `- Route: ${args.trip.route}`,
        `- Departs: ${args.trip.departAt}`,
        args.trip.pnr ? `- PNR: \`${args.trip.pnr}\`` : '',
        args.trip.bookingRef ? `- Booking: \`${args.trip.bookingRef}\`` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  if (args.extra?.length) {
    blocks.push(args.extra.join('\n\n'));
  }

  return blocks.filter(Boolean).join('\n\n');
}

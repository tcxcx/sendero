/**
 * save_traveler_preference — persist agent-inferred or user-confirmed
 * traveler preferences to the durable profile.
 *
 * Closes the dogfood gap: the agent inferred preferences during a
 * session ("favoriteTeam: Deportivo Cuenca", "preferredOrigin: AEP",
 * "voicePreferred: true") and offered "¿Guardo tus preferencias?",
 * but had no tool to actually persist when the traveler agreed.
 *
 * Write surface:
 *   - Known TravelerProfile columns get strongly-typed writes
 *     (dietary, allergies, pace, preferredCabin, redEyeOK,
 *     layoverMaxMin, preferredLang, voicePreferred).
 *   - Free-form keys (favoriteTeam, favoriteAirline, baseCity,
 *     interests[], etc) land in `User.metadata.preferences[key]`.
 *
 * Read by `prefetch_trip` + concierge tools so future turns get the
 * pre-filled context without re-asking. Append-only by design — to
 * remove a preference, write the empty value, don't try to "delete".
 *
 * Privacy: every write goes through the tenant-bound traveler
 * resolver (ctx.traveler.userId / tenantId) — the agent can never
 * write across tenants or to a User.id it doesn't own this turn.
 */

import { z } from 'zod';

import { type Prisma, prisma } from '@sendero/database';

import type { ToolDef, ToolContext } from './types';

// Strongly-typed columns on TravelerProfile. Writes here go to the
// dedicated column, not into `metadata.preferences` — keeps queryable
// fields queryable.
const PROFILE_KEYS = [
  'pace',
  'preferredCabin',
  'preferredLang',
  'redEyeOK',
  'layoverMaxMin',
  'voicePreferred',
  'dietary',
  'allergies',
] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

// Free-form keys agents commonly want to capture but the schema
// doesn't pre-allocate. Documented here so the agent learns canonical
// spellings; new keys still work — they just land alongside.
const KNOWN_FREE_FORM_KEYS = [
  'favoriteTeam',
  'favoriteSport',
  'favoriteAirline',
  'preferredOrigin', // IATA code; User.homeIata is the canonical store, but agent may stash here when uncertain
  'baseCity',
  'budgetTier', // 'budget' | 'mid' | 'premium' | 'luxury'
  'travelStyle', // 'solo' | 'family' | 'group' | 'couple' | 'business'
  'interests', // string[] e.g. ['soccer', 'food', 'history']
  'avoidTopics', // string[] — things the agent should not surface
] as const;

const inputSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(80)
    .describe(
      "Preference key. Strongly-typed (TravelerProfile column): pace, preferredCabin, preferredLang, redEyeOK, layoverMaxMin, voicePreferred, dietary, allergies. Free-form (User.metadata.preferences): favoriteTeam, favoriteSport, favoriteAirline, preferredOrigin, baseCity, budgetTier, travelStyle, interests, avoidTopics, or any other key you've inferred."
    ),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      z.array(z.number()),
    ])
    .describe(
      "The value to persist. Use null to clear. Arrays for list fields (dietary, allergies, interests). Strings for text values. Booleans for flags."
    ),
  source: z
    .enum(['user_confirmed', 'agent_inferred'])
    .default('agent_inferred')
    .describe(
      "Whether the user explicitly confirmed (high-confidence) or the agent inferred (low-confidence, may be revised on contradiction)."
    ),
});

export type SaveTravelerPreferenceInput = z.infer<typeof inputSchema>;

export interface SaveTravelerPreferenceResult {
  status: 'saved' | 'no_traveler' | 'invalid_value';
  message: string;
  /** Where the value landed: 'profile' | 'metadata'. */
  storage?: 'profile' | 'metadata';
  /** Resolved canonical key (some inputs get normalized — e.g. cabin → preferredCabin). */
  resolvedKey?: string;
}

function normalizeKey(input: string): string {
  // Common shorthand → canonical column
  const lower = input.trim().toLowerCase();
  if (lower === 'cabin' || lower === 'cabin_class' || lower === 'cabinclass')
    return 'preferredCabin';
  if (lower === 'lang' || lower === 'language' || lower === 'locale') return 'preferredLang';
  if (lower === 'team') return 'favoriteTeam';
  if (lower === 'sport') return 'favoriteSport';
  if (lower === 'airline') return 'favoriteAirline';
  if (lower === 'origin' || lower === 'home_airport' || lower === 'homeairport')
    return 'preferredOrigin';
  if (lower === 'city' || lower === 'home_city' || lower === 'homecity') return 'baseCity';
  if (lower === 'voice' || lower === 'voice_preferred') return 'voicePreferred';
  return input.trim();
}

async function saveTravelerPreference(
  input: SaveTravelerPreferenceInput,
  ctx?: ToolContext
): Promise<SaveTravelerPreferenceResult> {
  const tenantId = ctx?.traveler?.tenantId;
  const userId = ctx?.traveler?.userId;
  if (!tenantId || !userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      message:
        'No traveler resolved on this turn. Pass `travelerPhone` (E.164) on `call_sendero` so the preference binds to a real Sendero User.',
    };
  }

  const key = normalizeKey(input.key);

  // Branch 1 — known TravelerProfile column. Strongly-typed write.
  if ((PROFILE_KEYS as readonly string[]).includes(key)) {
    const k = key as ProfileKey;
    const v = input.value;
    const data: Record<string, unknown> = {};
    // Validate shape per column
    if (k === 'redEyeOK' || k === 'voicePreferred') {
      if (typeof v !== 'boolean') {
        return { status: 'invalid_value', message: `${k} requires boolean.` };
      }
      data[k] = v;
    } else if (k === 'layoverMaxMin') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return { status: 'invalid_value', message: 'layoverMaxMin requires non-negative number.' };
      }
      data[k] = Math.round(v);
    } else if (k === 'dietary' || k === 'allergies') {
      if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) {
        return { status: 'invalid_value', message: `${k} requires string[]` };
      }
      data[k] = v;
    } else {
      // pace, preferredCabin, preferredLang — string or null
      if (v !== null && typeof v !== 'string') {
        return { status: 'invalid_value', message: `${k} requires string or null.` };
      }
      data[k] = v;
    }
    await prisma.travelerProfile.upsert({
      where: { userId },
      create: { userId, tenantId, ...data },
      update: data,
    });
    return {
      status: 'saved',
      message: `Saved ${k}.`,
      storage: 'profile',
      resolvedKey: k,
    };
  }

  // Branch 2 — free-form key. Stash in User.metadata.preferences[key].
  // Read-modify-write since metadata is JSON; the tool boundary is
  // already serialized (one tool call at a time per turn) so no race.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { metadata: true },
  });
  const meta = (user?.metadata ?? {}) as Record<string, unknown>;
  const prefs = (meta.preferences ?? {}) as Record<string, unknown>;
  if (input.value === null) {
    delete prefs[key];
  } else {
    prefs[key] = {
      value: input.value,
      source: input.source,
      updatedAt: new Date().toISOString(),
    };
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      metadata: { ...meta, preferences: prefs } as Prisma.InputJsonValue,
    },
  });
  return {
    status: 'saved',
    message: `Saved ${key} to traveler profile.`,
    storage: 'metadata',
    resolvedKey: key,
  };
}

export const saveTravelerPreferenceTool: ToolDef<
  SaveTravelerPreferenceInput,
  SaveTravelerPreferenceResult
> = {
  name: 'save_traveler_preference',
  description:
    "Persist a traveler preference for future sessions. Use when the user explicitly confirms a preference ('soy hincha de Boca', 'siempre vuelo desde AEP', 'no como gluten') or when the agent has inferred a preference with high confidence and wants to lock it in. Strongly-typed keys (pace, preferredCabin, preferredLang, redEyeOK, layoverMaxMin, voicePreferred, dietary, allergies) write to TravelerProfile columns. Free-form keys (favoriteTeam, favoriteAirline, preferredOrigin, baseCity, budgetTier, travelStyle, interests, avoidTopics, or anything else) land in User.metadata.preferences. Use null to clear. Always pass `source` to mark provenance.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: {
        type: 'string',
        minLength: 2,
        maxLength: 80,
        description:
          'Preference key. Common: favoriteTeam, favoriteAirline, preferredOrigin, baseCity, budgetTier, travelStyle, interests, avoidTopics, preferredCabin, preferredLang, dietary, allergies, voicePreferred, redEyeOK, layoverMaxMin, pace.',
      },
      value: {
        description:
          'The value to persist. string | number | boolean | null | string[] | number[]. Use null to clear.',
      },
      source: {
        type: 'string',
        enum: ['user_confirmed', 'agent_inferred'],
        description: 'Provenance of the preference (default: agent_inferred).',
      },
    },
  },
  handler: saveTravelerPreference,
};

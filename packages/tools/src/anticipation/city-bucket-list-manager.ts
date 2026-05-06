/**
 * city_bucket_list_manager — HP1 Tool 2.
 *
 * The feedback loop. Stores traveler reactions to recommended places:
 * save / visited / loved / skip / revisit / recommend_to_friend.
 * Every action improves future ranking via the taste graph.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4 #2.
 *
 * **Experimental** (`experimental: true`) — same posture as
 * `hobby_profile_builder`. Dev-only gate at handler-time.
 *
 * Storage: row-per-(user, place) in `city_bucket_list_items`. Indexed
 * on (userId, city) for fast city-pack assembly + (tenantId, status)
 * for the operator strip's "loved this week" tile.
 */

import { BucketListItemStatus, prisma } from '@sendero/database';
import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

const ACTION_VALUES = [
  'save',
  'visited',
  'loved',
  'skip',
  'revisit',
  'recommend_to_friend',
] as const;

const inputSchema = z.object({
  travelerId: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  item: z.object({
    name: z.string().min(1).max(200),
    category: z.string().min(1).max(60),
    placeId: z.string().max(200).optional(),
    url: z.string().url().max(500).optional(),
  }),
  action: z.enum(ACTION_VALUES),
});

export type CityBucketListManagerInput = z.infer<typeof inputSchema>;

export type CityBucketListManagerResult =
  | {
      status: 'ok';
      listId: string;
      itemStatus: BucketListItemStatus;
      action: (typeof ACTION_VALUES)[number];
      message: string;
    }
  | {
      status: 'production_refused';
      message: string;
    };

// ── Deps (testability) ──────────────────────────────────────────────

export interface CityBucketListManagerDeps {
  findItem(args: {
    userId: string;
    city: string;
    name: string;
    placeId?: string;
  }): Promise<{ id: string; status: BucketListItemStatus } | null>;
  upsertItem(args: {
    userId: string;
    tenantId: string;
    city: string;
    name: string;
    category: string;
    placeId: string | null;
    url: string | null;
    status: BucketListItemStatus;
  }): Promise<{ id: string; status: BucketListItemStatus }>;
  updateItemStatus(args: {
    id: string;
    status: BucketListItemStatus;
  }): Promise<{ id: string; status: BucketListItemStatus }>;
}

export const dbDependencies: CityBucketListManagerDeps = {
  async findItem({ userId, city, name, placeId }) {
    // Prefer placeId match (canonical) when provided; fall back to name match.
    const row = placeId
      ? await prisma.cityBucketListItem.findFirst({
          where: { userId, city, placeId },
          select: { id: true, status: true },
        })
      : await prisma.cityBucketListItem.findFirst({
          where: { userId, city, name },
          select: { id: true, status: true },
        });
    return row;
  },
  async upsertItem(args) {
    const row = await prisma.cityBucketListItem.create({
      data: {
        userId: args.userId,
        tenantId: args.tenantId,
        city: args.city,
        name: args.name,
        category: args.category,
        placeId: args.placeId,
        url: args.url,
        status: args.status,
      },
      select: { id: true, status: true },
    });
    return row;
  },
  async updateItemStatus({ id, status }) {
    const row = await prisma.cityBucketListItem.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
    return row;
  },
};

// ── Action → status mapping ─────────────────────────────────────────

/**
 * Map traveler-facing action names to durable BucketListItemStatus
 * values. The action vocabulary is bigger than the status set
 * because some actions (`save`, `recommend_to_friend`) map to the
 * same status (`want_to_visit`) but carry different signal weight
 * downstream.
 */
function actionToStatus(action: (typeof ACTION_VALUES)[number]): BucketListItemStatus {
  switch (action) {
    case 'save':
    case 'recommend_to_friend':
      return BucketListItemStatus.want_to_visit;
    case 'visited':
      return BucketListItemStatus.visited;
    case 'loved':
      return BucketListItemStatus.loved;
    case 'skip':
      return BucketListItemStatus.skip;
    case 'revisit':
      return BucketListItemStatus.revisit;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runCityBucketListManager(
  input: CityBucketListManagerInput,
  ctx?: ToolContext,
  deps: CityBucketListManagerDeps = dbDependencies
): Promise<CityBucketListManagerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const tenantId = ctx!.traveler!.tenantId!;
  const userId = ctx?.traveler?.userId ?? input.travelerId;
  const desiredStatus = actionToStatus(input.action);

  const existing = await deps.findItem({
    userId,
    city: input.city,
    name: input.item.name,
    ...(input.item.placeId ? { placeId: input.item.placeId } : {}),
  });

  let row: { id: string; status: BucketListItemStatus };

  if (existing) {
    // Don't downgrade status (loved → skip is OK; save → loved is OK;
    // loved → save downgrades the bucket-list signal, which is
    // intentional only when the traveler explicitly said skip/revisit).
    row = await deps.updateItemStatus({ id: existing.id, status: desiredStatus });
  } else {
    row = await deps.upsertItem({
      userId,
      tenantId,
      city: input.city,
      name: input.item.name,
      category: input.item.category,
      placeId: input.item.placeId ?? null,
      url: input.item.url ?? null,
      status: desiredStatus,
    });
  }

  return {
    status: 'ok',
    listId: row.id,
    itemStatus: row.status,
    action: input.action,
    message:
      input.action === 'recommend_to_friend'
        ? `Saved "${input.item.name}" in ${input.city} — taste-graph signal stronger because you'd recommend it.`
        : `Marked "${input.item.name}" in ${input.city} as ${row.status}.`,
  };
}

// ── Tool registration ────────────────────────────────────────────────

export const cityBucketListManagerTool: ToolDef<
  CityBucketListManagerInput,
  CityBucketListManagerResult
> = {
  name: 'city_bucket_list_manager',
  internal: true,
  experimental: true,
  description:
    "Save / love / skip / revisit / recommend-to-friend feedback on city discoveries. Closes the taste-graph feedback loop — every action improves future ranking. Use when the traveler says 'I want to go there', 'we went, it was great', 'skip that', 'I'd take a friend back'. Idempotent on (userId, city, placeId). Always pass the city the traveler is in or planning for; the city is the index.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['travelerId', 'city', 'item', 'action'],
    properties: {
      travelerId: { type: 'string', minLength: 1, maxLength: 120 },
      city: { type: 'string', minLength: 1, maxLength: 120 },
      item: {
        type: 'object',
        required: ['name', 'category'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          category: { type: 'string', minLength: 1, maxLength: 60 },
          placeId: { type: 'string', maxLength: 200 },
          url: { type: 'string', format: 'uri', maxLength: 500 },
        },
      },
      action: { type: 'string', enum: [...ACTION_VALUES] },
    },
  },
  handler: runCityBucketListManager,
};

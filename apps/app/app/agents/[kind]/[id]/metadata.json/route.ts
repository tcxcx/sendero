/**
 * GET /agents/[kind]/[id]/metadata.json — public ERC-8004 agent metadata.
 *
 * This is the URL the IdentityRegistry contract stores via `tokenURI`
 * for every Sendero subject (org or user). Slug uses Sendero's stable
 * id (Tenant.id / User.id), not the on-chain agentId, so the URI
 * survives any future re-mint without breaking the on-chain pointer.
 *
 * The JSON shape mirrors the example used by Circle's ERC-8004
 * quickstart: name, description, image, agent_type, capabilities,
 * version. Sendero adds `subject_kind` + `holder_address` so external
 * agents indexing this metadata can decide whether to engage.
 *
 * **Image** comes from one of three sources, in priority order:
 *   1. The subject's own `metadata.profileImageUrl` (user-uploaded; v2)
 *   2. A deterministic random pick from Sendero's brand library:
 *      - orgs → `apps/app/public/brand/generated/*` (full-bleed art)
 *      - users → `apps/app/public/brand/icons/*` (small icons)
 *   3. Hard-coded fallback (signature passport image)
 *
 * The random pick is **deterministic per-subject** (seeded by the
 * subjectId) so re-renders return the same image — NFT galleries and
 * IPFS gateways cache by URL, so any change would silently break the
 * displayed avatar.
 *
 * Public, cached 5 min via `Cache-Control` headers — Pinata gateways,
 * NFT marketplaces, and ERC-8004 explorers can fetch without auth.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  kind: string;
  id: string;
}

const KIND_LABEL: Record<string, string> = {
  org: 'Sendero Travel Agency',
  user: 'Sendero Traveler',
};

const KIND_DESCRIPTION: Record<string, string> = {
  org: 'A travel agency or corporate travel desk operating on the Sendero protocol. Settles bookings on Arc-Testnet in USDC; reputation accumulates per ERC-8004.',
  user: 'A traveler with an on-chain identity on Arc-Testnet. Trip history and ratings accumulate against this single address regardless of which agency they book through.',
};

const KIND_CAPABILITIES: Record<string, string[]> = {
  org: ['book_flight', 'cancel_booking', 'settle_booking', 'give_feedback', 'request_validation'],
  user: ['rate_counterparty', 'submit_validation_response'],
};

/**
 * Brand image library — random pick is deterministic per subjectId so
 * gallery caches stay stable. Orgs get the full-bleed `generated/*`
 * art (story-map-wide, symbol collage, etc.); users get the small
 * branded icons. v2 will let users upload their own and we'll prefer
 * that override.
 *
 * Filenames are hard-coded (not fs.readdir on the hot path) so this
 * route stays serverless-cold-start-tiny. Sync this list with
 * `apps/app/public/brand/{generated,icons}/*` when files change.
 */
const ORG_BRAND_IMAGES = [
  'agent-workflow-map.png',
  'escrow-document-flow.png',
  'story-map-wide-a.png',
  'symbol-collage.png',
  'traveler-route-map.png',
] as const;

const USER_BRAND_ICONS = [
  '01-mail-circle.png',
  '01-sendero-s.png',
  '02-chat-bubbles.png',
  '02-north-star.png',
  '03-globe-stamp.png',
  '03-group-chat.png',
  '04-courier-profile.png',
  '04-network-nodes.png',
  '05-airplane-circle.png',
  '05-shopping-bag.png',
  '06-shield.png',
  '06-speed-lines-circle.png',
  '07-compass-circle.png',
  '07-magnifier.png',
  '08-capsule-star.png',
  '08-receipt.png',
  '09-archway.png',
  '09-secure-check-shield.png',
  '10-check-circle.png',
  '10-map-pin.png',
  '11-cost-gauge.png',
  '11-ticket.png',
  '12-binoculars.png',
  '12-traveler-bag.png',
  '13-globe.png',
  '13-stacked-stones.png',
  '14-bank.png',
  '14-bird.png',
  '15-square-portrait.png',
  '15-user-tie.png',
  '16-ai-chip.png',
] as const;

/**
 * FNV-1a 32-bit string hash. Sub-microsecond on a 36-char cuid. Used
 * to deterministically pick a brand image for a subjectId — same id
 * always lands on the same image, so the NFT gallery + IPFS-cached
 * URL never silently change.
 */
function hashSubject(subjectId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < subjectId.length; i++) {
    hash ^= subjectId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function placeholderImageFor(kind: 'org' | 'user', subjectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel';
  const list = kind === 'org' ? ORG_BRAND_IMAGES : USER_BRAND_ICONS;
  const folder = kind === 'org' ? 'generated' : 'icons';
  const file = list[hashSubject(subjectId) % list.length];
  return `${base.replace(/\/$/, '')}/brand/${folder}/${file}`;
}

/**
 * Read a user-supplied profile image override. Tenants pull from
 * `Tenant.brandLogoUrl`; users pull from `User.metadata.profileImageUrl`
 * (set via the future profile editor).
 */
function customImageFor(args: {
  kind: 'org' | 'user';
  tenant?: { brandLogoUrl: string | null } | null;
  user?: { metadata: unknown } | null;
}): string | null {
  if (args.kind === 'org') {
    return args.tenant?.brandLogoUrl ?? null;
  }
  const meta = (args.user?.metadata ?? {}) as { profileImageUrl?: unknown };
  return typeof meta.profileImageUrl === 'string' && meta.profileImageUrl
    ? meta.profileImageUrl
    : null;
}

export async function GET(_req: Request, { params }: { params: Promise<RouteParams> }) {
  const { kind, id } = await params;
  if (kind !== 'org' && kind !== 'user') {
    return NextResponse.json({ error: 'unknown_kind' }, { status: 404 });
  }

  let identity;
  try {
    // Prisma `select` doesn't accept `false` for relations — always include
    // both and pick the right one in code. Cheap: at most one is non-null.
    identity = await prisma.onchainIdentity.findFirst({
      where: kind === 'org' ? { kind: 'org', tenantId: id } : { kind: 'user', userId: id },
      select: {
        kind: true,
        agentId: true,
        contract: true,
        holderAddress: true,
        mintedAt: true,
        tenant: { select: { displayName: true, slug: true, brandLogoUrl: true } },
        user: { select: { displayName: true, metadata: true } },
      },
    });
  } catch (err) {
    console.error('[agents/metadata] db error', err);
    return NextResponse.json(
      { error: 'db_error', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  if (!identity) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const displayName =
    kind === 'org'
      ? (identity.tenant?.displayName ?? KIND_LABEL.org)
      : (identity.user?.displayName ?? KIND_LABEL.user);

  // Image priority: user/tenant override → deterministic random pick
  // from Sendero's brand library. The override path is what users + tenant
  // admins flip when they want their own avatar; the placeholder makes
  // sure the agent NFT renders beautifully in NFT galleries from day one.
  const image =
    customImageFor({ kind, tenant: identity.tenant, user: identity.user }) ??
    placeholderImageFor(kind, id);

  const body = {
    name: displayName,
    description: KIND_DESCRIPTION[kind],
    image,
    external_url: `https://app.sendero.travel/agents/${kind}/${id}`,
    agent_type: kind,
    subject_kind: kind,
    holder_address: identity.holderAddress,
    contract: identity.contract,
    on_chain_agent_id: identity.agentId,
    minted_at: identity.mintedAt?.toISOString() ?? null,
    capabilities: KIND_CAPABILITIES[kind],
    version: '1.0.0',
    sendero: {
      tenant_slug: identity.tenant?.slug ?? null,
      profile_url: `https://app.sendero.travel/agents/${kind}/${id}`,
    },
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}

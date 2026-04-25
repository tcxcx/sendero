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
        tenant: { select: { displayName: true, slug: true } },
        user: { select: { displayName: true } },
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

  const body = {
    name: displayName,
    description: KIND_DESCRIPTION[kind],
    image: `https://app.sendero.travel/agents/${kind}/${id}/opengraph-image`,
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

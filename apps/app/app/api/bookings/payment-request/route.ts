import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { z } from 'zod';

import { dispatchToTraveler, type TravelerChannelKind } from '@/lib/channel-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  tripId: z.string().min(1),
  orderId: z.string().min(1),
  bookingReference: z.string().min(1),
  amount: z.string().min(1),
  currency: z.string().min(1).default('USD'),
  channel: z.enum(['whatsapp', 'slack']).optional(),
});

export async function POST(req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: {
      id: true,
      displayName: true,
      gatewayConfig: { select: { evmDepositorAddress: true } },
      circleWallets: {
        where: { kind: 'operations', chain: { in: ['ARC-TESTNET', 'ARC'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { address: true },
      },
    },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  const trip = await prisma.trip.findFirst({
    where: { id: body.tripId, tenantId: tenant.id },
    select: {
      id: true,
      travelerId: true,
      intent: true,
      traveler: { select: { displayName: true } },
    },
  });
  if (!trip?.travelerId) {
    return NextResponse.json(
      {
        error: 'trip_has_no_traveler',
        message: 'Open a trip with a bound WhatsApp or Slack traveler before sending a payment request.',
      },
      { status: 422 }
    );
  }

  const arcDepositAddress =
    tenant.circleWallets[0]?.address ?? tenant.gatewayConfig?.evmDepositorAddress ?? null;
  if (!arcDepositAddress) {
    return NextResponse.json(
      {
        error: 'gateway_not_configured',
        message: 'This org does not have an Arc Gateway deposit wallet yet.',
      },
      { status: 503 }
    );
  }

  const travelerName = trip.traveler?.displayName ?? 'there';
  const tripSummary = summarizeTrip(trip.intent) ?? 'your trip';
  const forceChannel = body.channel as TravelerChannelKind | undefined;

  const result = await dispatchToTraveler({
    tenantId: tenant.id,
    tripId: trip.id,
    travelerUserId: trip.travelerId,
    forceChannel,
    message: {
      kind: 'card',
      id: `payment_request_${body.bookingReference}_${Date.now()}`,
      author: { role: 'agent', name: tenant.displayName },
      title: 'Payment needed to confirm your booking',
      body:
        `Hi ${travelerName}, ${tenant.displayName} is holding ${tripSummary} under ` +
        `PNR ${body.bookingReference}. Send ${body.amount} ${body.currency} to the org Gateway ` +
        `deposit wallet below so we can ticket it before the hold expires.`,
      bullets: [
        `Amount: ${body.amount} ${body.currency}`,
        `PNR: ${body.bookingReference}`,
        `Arc Gateway deposit wallet: ${arcDepositAddress}`,
      ],
      ctas: [
        {
          label: 'Open Circle faucet',
          kind: 'open_link',
          href: `https://faucet.circle.com/?address=${arcDepositAddress}`,
          emphasis: 'primary',
        },
      ],
      createdAt: new Date().toISOString(),
    },
  });

  if (!result.sent) {
    const failed = result as Extract<typeof result, { sent: false }>;
    return NextResponse.json(
      {
        status: 'not_sent',
        reason: failed.reason,
        channel: failed.channel ?? forceChannel ?? null,
        detail: failed.detail ?? null,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    status: 'sent',
    channel: result.channel,
    detail: result.detail ?? null,
    depositAddress: arcDepositAddress,
  });
}

function summarizeTrip(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null;
  const it = intent as { origin?: string; dest?: string; destination?: string };
  const dest = it.destination ?? it.dest;
  if (it.origin && dest) return `${it.origin} -> ${dest}`;
  if (dest) return String(dest);
  return null;
}

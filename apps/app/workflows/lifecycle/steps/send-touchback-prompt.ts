/**
 * Send Touch-1 to the traveler 48 hours before their first segment.
 *
 * Composes:
 *   1. `local_color_brief` preamble (3-5 destination bullets — weather,
 *      sunset, tipping, top-rated nearby) via the canonical tool.
 *   2. The 7 pending ancillary items as bullets — eSIM, transfer,
 *      insurance, restaurants, upgrade, etc.
 *   3. CTAs for the most-likely tap targets.
 *
 * Stamps `Trip.metadata.ancillaryChecklist.touchBackSentAt` after
 * dispatch. Never re-fires for the same trip (loadTouchbackContext
 * checks the flag before this step runs).
 *
 * Fail-soft: missing identity / install / send failure all log + return
 * without throwing. The watcher itself never retries.
 *
 * Spec: docs/architecture/concierge-magic.md §6.2.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

interface AncillaryItemSnapshot {
  status: 'pending' | 'done' | 'skipped' | 'unavailable';
}

interface AncillaryChecklistSnapshot {
  items?: Record<string, AncillaryItemSnapshot>;
  touchBackSentAt?: string | null;
}

const ITEM_LABELS: Record<string, { es: string; en: string }> = {
  upgrade: { es: '⚡ Upgrade Premium', en: '⚡ Cabin upgrade' },
  baggage: { es: '🛂 Equipaje extra', en: '🛂 Extra bags' },
  seat: { es: '💺 Elegir asiento', en: '💺 Pick seat' },
  lodging: { es: '🏠 Pasar info hotel', en: '🏠 Share lodging' },
  insurance: { es: '🛡 Seguro de viaje', en: '🛡 Travel insurance' },
  assistance: { es: '🚑 Asistencia médica', en: '🚑 Medical assistance' },
  transfer: { es: '🚖 Transfer aeropuerto', en: '🚖 Airport transfer' },
  esim: { es: '📱 eSIM internacional', en: '📱 International eSIM' },
  car: { es: '🚗 Auto de alquiler', en: '🚗 Car rental' },
};

export const sendTouchbackPrompt = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<void> => {
  'use step';

  try {
    const trip = await prisma.trip.findUnique({
      where: { id: args.tripId },
      select: {
        status: true,
        travelerId: true,
        tenantId: true,
        metadata: true,
        intent: true,
        bookings: {
          where: { status: 'ticketed' },
          orderBy: { bookedAt: 'asc' },
          take: 1,
          select: { segments: true },
        },
      },
    });
    if (!trip?.travelerId) return;
    if (trip.tenantId !== args.tenantId) return;
    if (trip.status === 'completed' || trip.status === 'canceled' || trip.status === 'failed') {
      return;
    }
    const meta = (trip.metadata ?? {}) as Record<string, unknown>;
    const checklist = (meta.ancillaryChecklist ?? {}) as AncillaryChecklistSnapshot;
    if (checklist.touchBackSentAt) {
      // Idempotent guard — last-second bail when a duplicate kickoff
      // raced past the loadTouchbackContext check.
      return;
    }

    // Pull destination signals from segments + intent.
    const segs = Array.isArray(trip.bookings[0]?.segments)
      ? (trip.bookings[0].segments as Array<Record<string, unknown>>)
      : [];
    const firstSeg = segs[0];
    const intent = (trip.intent ?? {}) as Record<string, unknown>;

    const destinationCity =
      (typeof firstSeg?.destinationCity === 'string' && firstSeg.destinationCity) ||
      (typeof intent.destination === 'string' && intent.destination) ||
      'tu destino';
    const destinationIso2 =
      (typeof firstSeg?.destinationIso2 === 'string' && firstSeg.destinationIso2) ||
      (typeof firstSeg?.destinationCountry === 'string' && firstSeg.destinationCountry) ||
      (typeof intent.destinationIso2 === 'string' && intent.destinationIso2) ||
      null;
    const departureDate =
      (typeof firstSeg?.departureAt === 'string' && firstSeg.departureAt.slice(0, 10)) ||
      (typeof intent.startDate === 'string' && intent.startDate) ||
      null;
    const returnDate = (typeof intent.endDate === 'string' && intent.endDate) || departureDate;

    // Lang from User profile when set, else Spanish (LatAm primary market).
    const profile = await prisma.travelerProfile.findUnique({
      where: { userId: trip.travelerId },
      select: { preferredLang: true },
    });
    const lang = (profile?.preferredLang ?? 'es').slice(0, 2).toLowerCase();
    const isEs = lang === 'es' || lang === 'pt'; // both LatAm-default to es-style copy

    // Compose local_color_brief preamble. Live tool call — never block
    // the touch-back on its failure (graceful degradation built in).
    const colorBullets: string[] = [];
    if (destinationIso2 && departureDate && returnDate) {
      try {
        const { localColorBrief } = await import('@sendero/tools');
        const brief = await localColorBrief({
          destinationIso2,
          destinationCity,
          dateRange: { from: departureDate, to: returnDate },
          lang,
        });
        colorBullets.push(...brief.bullets);
      } catch (err) {
        console.warn('[concierge-touchback] local_color_brief failed (non-fatal)', {
          tripId: args.tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Pending ancillaries — initialize defaults if checklist isn't
    // there yet (first time this trip touches the funnel).
    const items = checklist.items ?? {
      upgrade: { status: 'pending' },
      baggage: { status: 'pending' },
      seat: { status: 'pending' },
      lodging: { status: 'pending' },
      insurance: { status: 'pending' },
      assistance: { status: 'pending' },
      transfer: { status: 'pending' },
      esim: { status: 'pending' },
      car: { status: 'unavailable' },
    };
    const pendingKeys = Object.entries(items)
      .filter(([, v]) => v.status === 'pending')
      .map(([k]) => k);
    const pendingLabels = pendingKeys.map(k =>
      isEs ? (ITEM_LABELS[k]?.es ?? k) : (ITEM_LABELS[k]?.en ?? k)
    );

    const title = isEs ? `🧳 ${destinationCity} en 2 días` : `🧳 ${destinationCity} in 2 days`;
    const headerLine = isEs
      ? `Te ayudo con todo lo que falta. *${pendingKeys.length} de 7 ✓*`
      : `Let me help you wrap up the rest. *${pendingKeys.length} of 7 ✓*`;
    const bodyParts = [headerLine];
    if (colorBullets.length) {
      bodyParts.push('', ...colorBullets);
    }
    bodyParts.push('');
    bodyParts.push(isEs ? '*Pendientes:*' : '*Still open:*');
    for (const label of pendingLabels) {
      bodyParts.push(`▶ ${label}`);
    }
    bodyParts.push('');
    bodyParts.push(
      isEs
        ? '🎤 No tenés ganas de tipear? Mandá un audio.'
        : '🎤 Voice notes are 5x faster — feel free.'
    );

    const result = await dispatchToTraveler({
      tripId: args.tripId,
      tenantId: args.tenantId,
      travelerUserId: trip.travelerId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title,
        body: bodyParts.join('\n'),
        ctas: pickTopCtas(pendingKeys, args.tripId, isEs),
        createdAt: new Date().toISOString(),
      },
    });
    if (result.sent === false) {
      console.warn('[concierge-touchback] dispatch skipped', {
        tripId: args.tripId,
        reason: result.reason,
        channel: result.channel,
      });
      return;
    }

    // Stamp the idempotency flag. Atomic jsonb merge so a parallel
    // book_flight write to ancillaryChecklist.items doesn't get
    // clobbered.
    const sentAt = new Date().toISOString();
    await prisma.$executeRaw`
      UPDATE "trips"
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{ancillaryChecklist,touchBackSentAt}',
        to_jsonb(${sentAt}::text),
        true
      )
      WHERE id = ${args.tripId} AND "tenantId" = ${args.tenantId}
    `;
  } catch (err) {
    console.warn('[concierge-touchback] send failed (non-fatal)', {
      tripId: args.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Pick at most 3 CTAs from the pending items — WhatsApp interactive
 * buttons cap at 3. Bias toward eSIM + transfer + lodging because
 * those are the three with the most attach signal.
 */
function pickTopCtas(
  pendingKeys: string[],
  tripId: string,
  isEs: boolean
): Array<{
  label: string;
  kind: 'tool_invoke';
  value: string;
  emphasis?: 'primary' | 'secondary';
}> {
  const priority = ['esim', 'transfer', 'lodging', 'insurance', 'seat'];
  const picks = priority.filter(k => pendingKeys.includes(k)).slice(0, 3);
  return picks.map((k, i) => ({
    label: isEs ? (ITEM_LABELS[k]?.es ?? k) : (ITEM_LABELS[k]?.en ?? k),
    kind: 'tool_invoke' as const,
    value: `ancillary:${k}:${tripId}`,
    emphasis: i === 0 ? ('primary' as const) : ('secondary' as const),
  }));
}

/**
 * Trip-eligibility run orchestrator — async by design.
 *
 * Flow:
 *   1. `startEligibilityRun()` — writes a `pending` row, returns the
 *      run id to the caller.  Synchronous; latency is a single write.
 *   2. `executeEligibilityRun()` — the background worker.  Hits
 *      Sherpa (if configured), folds the response into our existing
 *      `verifyTravelDocuments()` deterministic logic, writes the
 *      verdict, and emits a `pg_notify('trip_eligibility_run:${id}',
 *      payload)` so SSE subscribers flip the UI instantly.
 *   3. `finalizeEligibilityRun()` — records the terminal state and
 *      fires the notify.
 *
 * This module is the single boundary where Sherpa results + local
 * signals meet.  The verdict the agent + UI see is always produced by
 * `verifyTravelDocuments()` — Sherpa just enriches the input with
 * real visa corridor data instead of the curated 50-entry table.
 *
 * Fallback ladder:
 *   - Sherpa key set + call succeeds → source='sherpa'
 *   - Sherpa key set + call fails    → source='fallback_rules'
 *   - No key                          → source='fallback_rules'
 *
 * At no point does a failure halt the booking flow.  That's the whole
 * point of the webhook-style async design.
 */

import { Prisma, type PrismaClient } from '@sendero/database';
import type {
  NormalizedRequirement,
  TravelNode,
  TravelPurpose,
  TripRequestAttributes,
} from '@sendero/sherpa';
import { postTrips, resolveSherpaConfig } from '@sendero/sherpa';

import { readDeclaredTravelerSignals, readTenantDefaultNationality } from './declared';
import { readVaultSignals } from './passport';
import type { TravelEligibilityVerdict, VerdictReason, VerifyTripInput } from './verify';
import { verifyTravelDocuments } from './verify';

export interface StartEligibilityRunInput {
  tenantId: string;
  /** Trip.id when the trip is persisted; optional for dry-run search. */
  tripId?: string | null;
  travelerId: string;
  originIso3: string;
  destinationIso3: string;
  departureDate: string;
  returnDate?: string | null;
  purpose: 'business' | 'leisure' | 'transit' | 'study' | 'medical';
  trigger: 'flight_search' | 'booking_review' | 'agent_tool' | 'manual';
  requestedByActor: string;
}

export interface EligibilityRunSummary {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  source: 'sherpa' | 'fallback_rules' | 'none' | null;
  verdict: TravelEligibilityVerdict | null;
}

/**
 * Persist a `pending` run and return its id immediately.  Caller is
 * expected to fire `executeEligibilityRun(id)` asynchronously (via
 * `void` + `.catch(log)` — we're on Vercel Functions so no worker
 * queue yet; background fire-and-forget within the request lifetime
 * is fine for hackathon scope).
 */
export async function startEligibilityRun(
  prisma: PrismaClient,
  input: StartEligibilityRunInput
): Promise<EligibilityRunSummary> {
  const row = await prisma.tripEligibilityRun.create({
    data: {
      tenantId: input.tenantId,
      tripId: input.tripId ?? null,
      travelerId: input.travelerId,
      status: 'pending',
      originIso3: input.originIso3.toUpperCase(),
      destinationIso3: input.destinationIso3.toUpperCase(),
      departureDate: new Date(input.departureDate),
      returnDate: input.returnDate ? new Date(input.returnDate) : null,
      purpose: input.purpose,
      trigger: input.trigger,
      requestedByActor: input.requestedByActor,
    },
    select: { id: true, status: true, source: true, verdict: true },
  });
  return {
    id: row.id,
    status: row.status as EligibilityRunSummary['status'],
    source: (row.source as EligibilityRunSummary['source']) ?? null,
    verdict: null,
  };
}

/**
 * Execute the run end-to-end: read vault + declared + tenant default,
 * call Sherpa (or fall back), fold into verifyTravelDocuments, persist
 * verdict, emit pg_notify.
 *
 * Safe to call from a request handler with `void` — the route returns
 * to the client immediately, the worker finishes in the background.
 */
export async function executeEligibilityRun(
  prisma: PrismaClient,
  runId: string
): Promise<EligibilityRunSummary> {
  await prisma.tripEligibilityRun.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date() },
  });

  try {
    const run = await prisma.tripEligibilityRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`run ${runId} disappeared`);

    const [passport, declared, tenantDefault] = await Promise.all([
      readVaultSignals(prisma, {
        tenantId: run.tenantId,
        userId: run.travelerId,
        documentVariant: 'passport',
        actor: {
          actorRef: run.requestedByActor ?? 'svc:eligibility-run',
          source: `eligibility_run:${runId}`,
          context: { trigger: run.trigger },
        },
      }),
      readDeclaredTravelerSignals(prisma, run.travelerId),
      readTenantDefaultNationality(prisma, run.tenantId),
    ]);

    // Prefer Sherpa when configured and we have a nationality to query.
    const nationalityIso =
      passport?.nationalityIso3 ?? declared?.declaredNationalityIso3 ?? tenantDefault ?? null;
    const sherpaCfg = resolveSherpaConfig();
    let sherpaRequirements: NormalizedRequirement[] = [];
    let providerRaw: unknown = null;
    let sherpaTripId: string | null = null;
    let source: 'sherpa' | 'fallback_rules' = 'fallback_rules';

    if (sherpaCfg && nationalityIso) {
      const purpose = (
        run.purpose.toUpperCase() === 'LEISURE' ? 'TOURISM' : run.purpose.toUpperCase()
      ) as TravelPurpose;

      const nodes: TravelNode[] = [
        {
          type: 'ORIGIN',
          locationCode: run.originIso3,
          departure: {
            date: run.departureDate.toISOString().slice(0, 10),
            travelMode: 'AIR',
          },
        },
        {
          type: 'DESTINATION',
          locationCode: run.destinationIso3,
          arrival: {
            date: run.departureDate.toISOString().slice(0, 10),
            travelMode: 'AIR',
          },
        },
      ];

      const attributes: TripRequestAttributes = {
        locale: 'en-US',
        currency: 'USD',
        travelNodes: nodes,
        traveller: {
          passports: [nationalityIso],
          travelPurposes: [purpose],
        },
      };
      const result = await postTrips({ attributes, config: sherpaCfg });
      if (result.ok === true) {
        sherpaRequirements = result.data.requirements;
        providerRaw = result.data.raw;
        sherpaTripId = result.data.sherpaTripId;
        source = 'sherpa';
      } else {
        console.warn(`[eligibility-run:${runId}] sherpa ${result.reason}: ${result.message}`);
      }
    }

    const verifyInput: VerifyTripInput = {
      passport,
      declared,
      tenantDefaultNationalityIso3: tenantDefault,
      originIso3: run.originIso3,
      destinationIso3: run.destinationIso3,
      departureDate: run.departureDate.toISOString().slice(0, 10),
      returnDate: run.returnDate ? run.returnDate.toISOString().slice(0, 10) : null,
      purpose: run.purpose as VerifyTripInput['purpose'],
    };

    const verdict = verifyTravelDocuments(verifyInput);
    overlaySherpaOntoVerdict(verdict, sherpaRequirements);

    await prisma.tripEligibilityRun.update({
      where: { id: runId },
      data: {
        status: 'succeeded',
        source,
        sherpaTripId,
        verdict: verdict as unknown as Prisma.InputJsonValue,
        providerRaw: providerRaw !== null ? (providerRaw as Prisma.InputJsonValue) : Prisma.DbNull,
        completedAt: new Date(),
      },
    });

    await emitRunNotify(prisma, runId, { status: 'succeeded', verdict });

    return {
      id: runId,
      status: 'succeeded',
      source,
      verdict,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.tripEligibilityRun.update({
      where: { id: runId },
      data: { status: 'failed', failureReason: message, completedAt: new Date() },
    });
    await emitRunNotify(prisma, runId, { status: 'failed', message });
    return { id: runId, status: 'failed', source: null, verdict: null };
  }
}

/**
 * Overlay Sherpa requirements on top of the deterministic verdict.
 * When Sherpa says the corridor needs an eTA / eVisa, we trust it over
 * the curated table (Sherpa's data is built from 2000+ gov sources,
 * ours is 50 corridors).  The `ancillary` hint — if present — is what
 * the UI uses to surface the visa-add-on CTA in the booking flow.
 */
function overlaySherpaOntoVerdict(
  verdict: TravelEligibilityVerdict,
  requirements: NormalizedRequirement[]
): void {
  if (requirements.length === 0) return;
  // Strip the curated 'visa_*' reasons; Sherpa is more authoritative.
  verdict.reasons = verdict.reasons.filter(
    r =>
      r.code !== 'visa_free' &&
      r.code !== 'visa_on_arrival_destination' &&
      r.code !== 'eta_required' &&
      r.code !== 'evisa_required' &&
      r.code !== 'visa_required_not_on_file' &&
      r.code !== 'visa_corridor_uncurated'
  );
  for (const req of requirements) {
    const next = mapNormalizedRequirementToReason(req);
    if (next) verdict.reasons.push(next);
  }
  // Re-collapse status after the rewrite.
  if (verdict.reasons.some(r => r.severity === 'block')) verdict.status = 'block';
  else if (verdict.reasons.some(r => r.severity === 'warn')) verdict.status = 'warn';
  else verdict.status = 'ok';
}

function mapNormalizedRequirementToReason(req: NormalizedRequirement): VerdictReason | null {
  switch (req.kind) {
    case 'visa_free':
      return { code: 'visa_free', severity: 'ok' };
    case 'visa_on_arrival':
      return { code: 'visa_on_arrival_destination', severity: 'ok' };
    case 'eta_required':
      return { code: 'eta_required', severity: 'warn' };
    case 'evisa_required':
      return { code: 'evisa_required', severity: 'warn' };
    case 'visa_required':
      return { code: 'visa_required_not_on_file', severity: 'block' };
    default:
      return null;
  }
}

/**
 * Fire a `pg_notify('trip_eligibility_run:${runId}', payload)` so SSE
 * subscribers in the app (+ future webhooks) observe the transition
 * in real time.  Safe no-op if the channel has no listeners.
 */
async function emitRunNotify(
  prisma: PrismaClient,
  runId: string,
  payload: {
    status: 'running' | 'succeeded' | 'failed';
    verdict?: TravelEligibilityVerdict;
    message?: string;
  }
): Promise<void> {
  const channel = `trip_eligibility_run:${runId}`;
  await prisma.$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, JSON.stringify(payload));
}

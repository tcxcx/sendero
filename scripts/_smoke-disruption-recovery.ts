#!/usr/bin/env bun
/**
 * Smoke: trip_disruption_recovery using the abuelo case verbatim.
 *
 *   bun run scripts/_smoke-disruption-recovery.ts
 */

import 'dotenv/config';

import {
  classifyDisruptionTool,
  buildInsuranceClaimPacketTool,
  tripDisruptionRecoveryTool,
  recoveryCaseFileRendererTool,
} from '../packages/tools/src/disruption-recovery';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

const ABUELO_DESCRIPTION = `Mi abuelo no pudo viajar por un impedimento legal (problema con migraciones / orden judicial). El boleto era no reembolsable: la aerolínea no devolvió ni un solo centavo de los $2000 pagados, y para cambiar la fecha cobraban $270 adicionales. Ya no quisieron pagar la diferencia. Familia con mucho dolor — Gonzalo y Ernesto regresando a Quito.`;

console.log('\n=== classify_disruption_situation ===');
const classified = await classifyDisruptionTool.handler(
  {
    description: ABUELO_DESCRIPTION,
    // Disruption became known the day BEFORE departure (typical case).
    departureAtIso: '2026-05-07T08:00:00-05:00',
    disruptionAtIso: '2026-05-05T15:59:00-05:00',
  } as never,
  ctx
);
if (classified.status === 'ok') {
  console.log(`  kind:        ${classified.kind} (${classified.confidence})`);
  console.log(`  evidence:    ${(classified.evidence ?? []).join(' / ')}`);
  console.log(`  hours-to-dep: ${classified.hoursToDeparture}`);
  console.log(`  docs needed: ${(classified.needsDocumentation ?? []).join(', ')}`);
  console.log(`  recommended path:`);
  for (const p of classified.recommendedPath ?? []) console.log(`    ${p.step.padEnd(28)} — ${p.why}`);
}

console.log('\n=== trip_disruption_recovery (full orchestrator) ===');
const recovery = await tripDisruptionRecoveryTool.handler(
  {
    description: ABUELO_DESCRIPTION,
    airlineName: 'LATAM Airlines',
    airlineIata: 'LA',
    travelerName: 'abuelo Espinosa',
    bookingReference: 'PNR-DEMO-ABUELO',
    paidNonRefundableUsd: 2000,
    bookedTotalUsd: 2000,
    route: 'UIO ↔ MIA (round trip)',
    departureAtIso: '2026-05-07T08:00:00-05:00',
    countryOfTravelerCode: 'EC',
    hasInsurance: false,
    locale: 'es-EC',
  } as never,
  ctx
);
if (recovery.status === 'ok') {
  console.log(`  ${recovery.message}`);
  console.log(`  classification kind: ${recovery.classification?.kind}`);
  console.log(`  likely outcome:      ${recovery.caseFile?.likelyOutcome}`);
  console.log(`  documents required:  ${recovery.caseFile?.documentsRequired.join(' / ')}`);
  console.log(`\n  RECOVERY CHAIN:`);
  for (let i = 0; i < (recovery.chain ?? []).length; i++) {
    const s = recovery.chain![i]!;
    console.log(`    ${i + 1}. [${s.step}]${s.tool ? ` → ${s.tool}` : ''}`);
    console.log(`       why:     ${s.why}`);
    console.log(`       expect:  ${s.expectedOutcome}`);
  }
  if (recovery.compassionateResearch) {
    console.log(`\n  compassionate research: ${recovery.compassionateResearch.status} via ${(recovery.compassionateResearch as { via?: string }).via ?? '?'}`);
    if (recovery.compassionateResearch.status === 'ok') {
      const p = recovery.compassionateResearch.policy;
      console.log(`    exists:        ${p.policyExists}`);
      console.log(`    summary:       ${p.policySummary.slice(0, 220)}`);
      console.log(`    offers:        ${p.refundOrCreditOffered}`);
      console.log(`    contact path:  ${p.contactPath}`);
    }
  }
}

console.log('\n=== build_insurance_claim_packet (hypothetical, with policy) ===');
const claim = await buildInsuranceClaimPacketTool.handler(
  {
    travelerName: 'abuelo Espinosa',
    policyNumber: 'AON-DEMO-2026',
    insurerName: 'Aon Travel',
    trip: {
      bookingReference: 'PNR-DEMO-ABUELO',
      bookedTotalUsd: 2000,
      paidNonRefundableUsd: 2000,
      departureAtIso: '2026-05-05T08:00:00-05:00',
      route: 'UIO ↔ MIA',
      airlineName: 'LATAM Airlines',
    },
    disruption: {
      kind: 'legal_hold',
      description: ABUELO_DESCRIPTION,
      occurredAtIso: '2026-05-05T15:59:00-05:00',
      documentationOnFile: ['booking confirmation (PNR + invoice)'],
    },
    airlineResponse: {
      refundOfferedUsd: 0,
      creditOfferedUsd: 0,
      waiverGranted: false,
      rejectionReason: 'Fare class non-refundable; change fee USD 270 not paid by traveler.',
    },
    locale: 'es-EC',
  } as never,
  ctx
);
if (claim.status === 'ok') {
  console.log(`  subject:        ${claim.packet?.claimSubject}`);
  console.log(`  amount claimed: USD ${claim.packet?.amountClaimedUsd}`);
  console.log(`  evidence:`);
  for (const e of claim.packet?.evidence ?? []) console.log(`    [${e.status === 'on_file' ? '✓' : '?'}] ${e.kind}`);
  console.log(`\n  narrative (first 500 chars):`);
  console.log(`  ${(claim.packet?.claimNarrative ?? '').slice(0, 500)}`);
}

console.log('\n=== recovery_case_file_renderer (Slack blocks) ===');
const rendered = await recoveryCaseFileRendererTool.handler(
  {
    caseFile: {
      travelerName: 'abuelo Espinosa',
      bookingReference: 'PNR-DEMO-ABUELO',
      airlineName: 'LATAM Airlines',
      route: 'UIO ↔ MIA (round trip)',
      departureAtIso: '2026-05-05T08:00:00-05:00',
      paidNonRefundableUsd: 2000,
      kind: 'legal_hold',
      description: ABUELO_DESCRIPTION,
      documentsOnFile: ['booking confirmation (PNR + invoice)'],
      documentsNeeded: ['court document or detention letter', 'official ID-detention letter'],
      duffelStepsAttempted: [
        'display_offer_conditions → confirmed non-refundable fare class',
        'cancel_order_quote → returned $0 refund per fare rules',
        'request_order_change → returned change_total_amount USD 270 unpaid by family',
      ],
      compassionatePolicySummary:
        'LATAM has a documented compassionate-fare-waiver policy for legal-hold and bereavement: requires court / consulate document, contact path is the LATAM Special Assistance desk by phone (not the website self-service).',
    },
    format: 'slack_blocks',
    locale: 'es-EC',
  } as never,
  ctx
);
if (rendered.status === 'ok') {
  console.log((rendered as { text: string }).text);
}

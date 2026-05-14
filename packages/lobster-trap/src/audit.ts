import type {
  LobsterTrapContext,
  LobsterTrapInspectionReport,
  LobsterTrapSecurityAlertPayload,
} from './types';
import { asRecord, firstString, hashIdentifier, numberOrNull } from './utils';

export function summarizeLobsterTrapReport(raw: unknown): LobsterTrapInspectionReport | null {
  const report = asRecord(raw);
  if (!report) return null;
  const lobster = asRecord(report._lobstertrap) ?? report;
  if (!looksLikeInspectionReport(lobster)) return null;
  const ingress = asRecord(lobster.ingress);
  const egress = asRecord(lobster.egress);
  const ingressDetected = asRecord(ingress?.detected);
  const egressDetected = asRecord(egress?.detected);
  const ingressAction = firstString(ingress?.action);
  const egressAction = firstString(egress?.action);
  const matchedRule = firstString(
    ingress?.matched_rule,
    ingress?.matchedRule,
    egress?.matched_rule,
    egress?.matchedRule
  );

  return {
    requestId: firstString(lobster.request_id, lobster.requestId),
    verdict: effectiveVerdict(firstString(lobster.verdict), ingressAction, egressAction),
    ingressAction,
    egressAction,
    ingressRiskScore: numberOrNull(ingressDetected?.risk_score),
    egressRiskScore: numberOrNull(egressDetected?.risk_score),
    ingressIntent: firstString(ingressDetected?.intent_category),
    egressIntent: firstString(egressDetected?.intent_category),
    ingressMismatches: Array.isArray(ingress?.mismatches) ? ingress.mismatches : [],
    matchedRule,
    raw,
  };
}

export function lobsterTrapVerdictHeader(reports: LobsterTrapInspectionReport[]): string {
  if (reports.some(report => report.verdict === 'DENY')) return 'DENY';
  if (reports.some(report => report.verdict === 'QUARANTINE')) return 'QUARANTINE';
  if (reports.some(report => report.verdict === 'HUMAN_REVIEW')) return 'HUMAN_REVIEW';
  if (reports.some(report => report.verdict === 'RATE_LIMIT')) return 'RATE_LIMIT';
  if (reports.some(report => report.verdict === 'LOG')) return 'LOG';
  return reports.length > 0 ? 'ALLOW' : 'not_inspected';
}

export function severityForVerdict(verdict: string): 'medium' | 'high' | 'critical' {
  if (verdict === 'DENY' || verdict === 'QUARANTINE') return 'critical';
  if (verdict === 'HUMAN_REVIEW') return 'high';
  return 'medium';
}

function looksLikeInspectionReport(report: Record<string, unknown>): boolean {
  return Boolean(
    report.verdict ||
      report.action ||
      report.ingress ||
      report.egress ||
      report.request_id ||
      report.requestId
  );
}

function effectiveVerdict(...actions: Array<string | null>): string {
  const ranked = actions
    .filter((action): action is string => Boolean(action))
    .sort((a, b) => verdictRank(b) - verdictRank(a));
  return ranked[0] ?? 'UNKNOWN';
}

function verdictRank(action: string): number {
  switch (action) {
    case 'DENY':
      return 60;
    case 'QUARANTINE':
      return 50;
    case 'HUMAN_REVIEW':
      return 40;
    case 'RATE_LIMIT':
      return 30;
    case 'LOG':
      return 20;
    case 'ALLOW':
      return 10;
    default:
      return 0;
  }
}

export function securityAlertPayload(args: {
  report: LobsterTrapInspectionReport;
  context: Omit<LobsterTrapContext, 'onReport'>;
}): LobsterTrapSecurityAlertPayload {
  return {
    vendor: 'veea-lobstertrap',
    requestId: args.report.requestId,
    verdict: args.report.verdict,
    ingressAction: args.report.ingressAction,
    egressAction: args.report.egressAction,
    ingressIntent: args.report.ingressIntent,
    egressIntent: args.report.egressIntent,
    ingressRiskScore: args.report.ingressRiskScore,
    egressRiskScore: args.report.egressRiskScore,
    matchedRule: args.report.matchedRule,
    mismatchCount: args.report.ingressMismatches.length,
    tenantId: args.context.tenantId,
    userHash: hashIdentifier(args.context.userId),
    channel: args.context.channel,
    turnId: args.context.turnId,
    tripId: args.context.tripId ?? null,
    authMode: args.context.authMode,
    x402: args.context.x402,
  };
}

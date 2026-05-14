export type LobsterTrapAuthMode = 'internal' | 'api_key';

export type LobsterTrapVerdict =
  | 'ALLOW'
  | 'DENY'
  | 'HUMAN_REVIEW'
  | 'QUARANTINE'
  | 'RATE_LIMIT'
  | 'LOG'
  | 'UNKNOWN';

export interface LobsterTrapContext {
  tenantId: string;
  userId: string;
  channel: string;
  turnId: string;
  tripId?: string | null;
  authMode: LobsterTrapAuthMode;
  x402: boolean;
  onReport?: (report: LobsterTrapInspectionReport) => void;
}

export interface LobsterTrapInspectionReport {
  requestId: string | null;
  verdict: LobsterTrapVerdict | string;
  ingressAction: LobsterTrapVerdict | string | null;
  egressAction: LobsterTrapVerdict | string | null;
  ingressRiskScore: number | null;
  egressRiskScore: number | null;
  ingressIntent: string | null;
  egressIntent: string | null;
  ingressMismatches: unknown[];
  matchedRule: string | null;
  raw: unknown;
}

export interface LobsterTrapSecurityAlertPayload {
  vendor: 'veea-lobstertrap';
  requestId: string | null;
  verdict: string;
  ingressAction: string | null;
  egressAction: string | null;
  ingressIntent: string | null;
  egressIntent: string | null;
  ingressRiskScore: number | null;
  egressRiskScore: number | null;
  matchedRule: string | null;
  mismatchCount: number;
  tenantId: string;
  userHash: string;
  channel: string;
  turnId: string;
  tripId: string | null;
  authMode: LobsterTrapAuthMode;
  x402: boolean;
}

export interface LobsterTrapRedTeamFixture {
  id: string;
  category:
    | 'benign'
    | 'prompt_injection'
    | 'exfiltration'
    | 'credential_leak'
    | 'role_impersonation';
  prompt: string;
  expectedAction: LobsterTrapVerdict;
  rationale: string;
}

import { describe, expect, test } from 'bun:test';

import {
  lobsterTrapVerdictHeader,
  securityAlertPayload,
  severityForVerdict,
  summarizeLobsterTrapReport,
} from './audit';

describe('lobster trap audit', () => {
  test('summarizes response metadata into audit-safe fields', () => {
    const report = summarizeLobsterTrapReport({
      id: 'chatcmpl_test',
      _lobstertrap: {
        request_id: 'req_123',
        verdict: 'HUMAN_REVIEW',
        ingress: {
          action: 'HUMAN_REVIEW',
          mismatches: [{ field: 'declared_intent' }],
          detected: {
            intent_category: 'credential_access',
            risk_score: 0.72,
          },
          matched_rule: 'review_high_risk',
        },
        egress: {
          action: 'ALLOW',
          detected: { intent_category: 'general', risk_score: 0.05 },
        },
      },
    });

    expect(report).toMatchObject({
      requestId: 'req_123',
      verdict: 'HUMAN_REVIEW',
      ingressAction: 'HUMAN_REVIEW',
      egressAction: 'ALLOW',
      ingressRiskScore: 0.72,
      egressRiskScore: 0.05,
      ingressIntent: 'credential_access',
      matchedRule: 'review_high_risk',
    });
    expect(report?.ingressMismatches).toHaveLength(1);
  });

  test('ignores plain model JSON without Lobster Trap inspection metadata', () => {
    expect(
      summarizeLobsterTrapReport({
        id: 'chatcmpl_plain',
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      })
    ).toBeNull();
  });

  test('derives effective verdict from ingress or egress action when top-level verdict is absent', () => {
    const report = summarizeLobsterTrapReport({
      _lobstertrap: {
        request_id: 'req_456',
        ingress: {
          action: 'ALLOW',
          detected: { risk_score: 0.1 },
        },
        egress: {
          action: 'QUARANTINE',
          detected: { risk_score: 0.8 },
        },
      },
    });

    expect(report?.verdict).toBe('QUARANTINE');
    expect(lobsterTrapVerdictHeader(report ? [report] : [])).toBe('QUARANTINE');
    expect(severityForVerdict(report?.verdict ?? 'UNKNOWN')).toBe('critical');
  });

  test('verdict header returns the highest-risk observed action', () => {
    expect(
      lobsterTrapVerdictHeader([
        { verdict: 'ALLOW' } as never,
        { verdict: 'HUMAN_REVIEW' } as never,
        { verdict: 'DENY' } as never,
      ])
    ).toBe('DENY');
    expect(lobsterTrapVerdictHeader([])).toBe('not_inspected');
  });

  test('builds security alert payloads without raw prompt or response data', () => {
    const payload = securityAlertPayload({
      report: {
        requestId: 'req_123',
        verdict: 'DENY',
        ingressAction: 'DENY',
        egressAction: null,
        ingressRiskScore: 0.91,
        egressRiskScore: null,
        ingressIntent: 'credential_access',
        egressIntent: null,
        ingressMismatches: [],
        matchedRule: 'deny_credentials',
        raw: { prompt: 'secret raw text' },
      },
      context: {
        tenantId: 'ten_test',
        userId: 'usr_test',
        channel: 'whatsapp',
        turnId: 'turn_001',
        tripId: 'trip_001',
        authMode: 'internal',
        x402: false,
      },
    });

    expect(payload.userHash).toMatch(/^sha256:/);
    expect(JSON.stringify(payload)).not.toContain('secret raw text');
    expect(severityForVerdict(payload.verdict)).toBe('critical');
  });
});

import { describe, expect, test } from 'bun:test';

import {
  injectLobsterTrapMetadata,
  lobsterTrapVerdictHeader,
  summarizeLobsterTrapReport,
  type LobsterTrapContext,
} from './lobstertrap';

const context: LobsterTrapContext = {
  tenantId: 'ten_test',
  userId: 'usr_test',
  channel: 'mcp',
  turnId: 'turn_001',
  tripId: 'trip_001',
  authMode: 'api_key',
  x402: true,
};

describe('lobstertrap integration helpers', () => {
  test('injects declared intent metadata without storing raw user identifiers', () => {
    const body = injectLobsterTrapMetadata(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Book a car' }],
      },
      context
    ) as { _lobstertrap: Record<string, unknown> };

    expect(body._lobstertrap.agent_id).toBe('sendero-mcp');
    expect(body._lobstertrap.declared_intent).toBe('production_agent_x402');
    expect(body._lobstertrap.tenant_id).toBe('ten_test');
    expect(body._lobstertrap.subject_hash).toMatch(/^sha256:/);
    expect(body._lobstertrap.subject_hash).not.toContain('usr_test');
    expect(body._lobstertrap.x402).toBe(true);
  });

  test('summarizes Lobster Trap response metadata into audit-safe fields', () => {
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
});

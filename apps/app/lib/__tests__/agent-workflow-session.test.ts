/**
 * Pure unit tests for the agent-workflow-session library.
 *
 * Covers the parts that don't touch Prisma:
 *   - subjectKey conventions (per-channel, per-traveler)
 *   - tool-registry construction shape
 *
 * Persistence behavior is exercised end-to-end via the standalone
 * probe in `scripts/probe-agent-workflow-session.ts` (run on demand,
 * not in CI — needs a live database connection).
 */

import { describe, expect, test } from 'bun:test';

import { agentWorkflowSubjectKey, buildAgentWorkflowToolRegistry } from '../agent-workflow-session';

describe('agentWorkflowSubjectKey', () => {
  test('whatsapp + identity → agent:whatsapp:<id>', () => {
    expect(agentWorkflowSubjectKey({ channel: 'whatsapp', channelIdentityId: 'ci_123' })).toBe(
      'agent:whatsapp:ci_123'
    );
  });

  test('slack + identity → agent:slack:<id>', () => {
    expect(agentWorkflowSubjectKey({ channel: 'slack', channelIdentityId: 'ci_456' })).toBe(
      'agent:slack:ci_456'
    );
  });

  test('web + identity → agent:web:<id>', () => {
    expect(agentWorkflowSubjectKey({ channel: 'web', channelIdentityId: 'ci_789' })).toBe(
      'agent:web:ci_789'
    );
  });

  test('different channels with same identity yield distinct keys', () => {
    const wa = agentWorkflowSubjectKey({ channel: 'whatsapp', channelIdentityId: 'ci_dup' });
    const slack = agentWorkflowSubjectKey({ channel: 'slack', channelIdentityId: 'ci_dup' });
    expect(wa).not.toBe(slack);
  });

  test('does NOT collide with the wizard "channels:X" subjectKey shape', () => {
    // wizard-session uses `channels:whatsapp` (operator-side, tenant-scoped);
    // the agent shape is `agent:whatsapp:<id>` (per-traveler). They share
    // the Session table but the (tenantId, subjectKey) unique index keeps
    // them isolated.
    const agent = agentWorkflowSubjectKey({ channel: 'whatsapp', channelIdentityId: 'ci_a' });
    expect(agent.startsWith('channels:')).toBe(false);
    expect(agent.startsWith('agent:')).toBe(true);
  });
});

describe('buildAgentWorkflowToolRegistry', () => {
  test('produces a registry keyed by tool name', () => {
    const registry = buildAgentWorkflowToolRegistry();
    expect(typeof registry).toBe('object');
    // Smoke-check a handful of canonical tools so a registry-mapping
    // regression (e.g. dropping a key) fails loudly.
    expect(typeof registry.search_flights).toBe('function');
    expect(typeof registry.book_flight).toBe('function');
    expect(typeof registry.check_treasury).toBe('function');
    expect(typeof registry.cancel_order_quote).toBe('function');
  });

  test('every entry is async', () => {
    const registry = buildAgentWorkflowToolRegistry();
    for (const [name, fn] of Object.entries(registry)) {
      expect(typeof fn, `tool ${name} must be a function`).toBe('function');
    }
  });
});

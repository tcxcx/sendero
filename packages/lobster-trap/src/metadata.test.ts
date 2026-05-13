import { describe, expect, test } from 'bun:test';

import { declaredDomains, injectLobsterTrapMetadata } from './metadata';
import type { LobsterTrapContext } from './types';

const context: LobsterTrapContext = {
  tenantId: 'ten_test',
  userId: 'usr_test',
  channel: 'mcp',
  turnId: 'turn_001',
  tripId: 'trip_001',
  authMode: 'api_key',
  x402: true,
};

describe('lobster trap metadata', () => {
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

  test('declares enterprise model, provider, Self, Duffel, and Circle domains', () => {
    expect(declaredDomains()).toEqual(
      expect.arrayContaining([
        'api.openai.com',
        'api.duffel.com',
        'api.circle.com',
        'docs.self.xyz',
      ])
    );
  });
});

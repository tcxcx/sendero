/**
 * Phase 4 v1 — pure-validation smoke for the intent helper.
 *
 * No on-chain submit happens in v1, so no env reads, no umi context.
 * Verifies the descriptor shape callers persist into OnchainIdentity.
 */

import { describe, expect, test } from 'bun:test';

import {
  AGENT_REGISTRY_PROGRAM_ID,
  describeTenantAgentRegistration,
} from './register-tenant-agent';

const VALID_TREASURY = '11111111111111111111111111111112'; // System program — valid base58 pubkey

describe('describeTenantAgentRegistration', () => {
  test('returns intent descriptor with the canonical program id', () => {
    const out = describeTenantAgentRegistration({
      tenantId: 'tenant_abc',
      treasuryPubkey: VALID_TREASURY,
      name: 'Vale Corporate Travel',
      identityUri: 'https://app.sendero.travel/agents/org/tenant_abc/metadata.json',
    });
    expect(out.status).toBe('intent');
    expect(out.programId).toBe(AGENT_REGISTRY_PROGRAM_ID);
    expect(out.tenantId).toBe('tenant_abc');
    expect(out.note).toContain('Phase 4.x');
  });

  test('rejects missing tenantId', () => {
    expect(() =>
      describeTenantAgentRegistration({
        tenantId: '',
        treasuryPubkey: VALID_TREASURY,
        name: 'x',
        identityUri: 'https://x',
      })
    ).toThrow(/tenantId/);
  });

  test('rejects invalid base58 treasury pubkey', () => {
    expect(() =>
      describeTenantAgentRegistration({
        tenantId: 'tenant_abc',
        treasuryPubkey: '0xnot-a-solana-pubkey',
        name: 'x',
        identityUri: 'https://x',
      })
    ).toThrow();
  });

  test('rejects empty identityUri', () => {
    expect(() =>
      describeTenantAgentRegistration({
        tenantId: 'tenant_abc',
        treasuryPubkey: VALID_TREASURY,
        name: 'x',
        identityUri: '',
      })
    ).toThrow(/identityUri/);
  });
});

import type { LobsterTrapContext } from './types';
import { hashIdentifier } from './utils';

export function injectLobsterTrapMetadata(body: unknown, context: LobsterTrapContext): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  const existing =
    record._lobstertrap &&
    typeof record._lobstertrap === 'object' &&
    !Array.isArray(record._lobstertrap)
      ? (record._lobstertrap as Record<string, unknown>)
      : {};

  return {
    ...record,
    _lobstertrap: {
      ...existing,
      agent_id: `sendero-${context.channel}`,
      declared_intent: declaredIntent(context),
      declared_domains: declaredDomains(),
      tenant_id: context.tenantId,
      subject_hash: hashIdentifier(context.userId),
      turn_id: context.turnId,
      auth_mode: context.authMode,
      x402: context.x402,
      ...(context.tripId ? { trip_id: context.tripId } : {}),
    },
  };
}

export function declaredIntent(context: Pick<LobsterTrapContext, 'channel' | 'x402'>): string {
  if (context.x402) return 'production_agent_x402';
  if (context.channel === 'mcp') return 'external_agent';
  return 'travel_concierge';
}

export function declaredDomains(): string[] {
  return [
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'gateway.ai.vercel.com',
    'api.duffel.com',
    'api.circle.com',
    'gateway-api-testnet.circle.com',
    'docs.self.xyz',
  ];
}

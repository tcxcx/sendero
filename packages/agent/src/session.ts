/**
 * Stateful conversation sessions.
 *
 * Phase 2 used `Session` only for workflow pauses. Phase 8 extends it
 * into the general traveler-conversation store. A session holds the
 * last N turns so the LLM can carry context across WA messages /
 * Slack threads / web reloads without rebuilding from scratch.
 *
 * Session key = `(tenantId, subjectKey)` where subjectKey is derived
 * from the ChannelIdentity:
 *   - WA: BSUID || phone || username
 *   - Slack: `${enterpriseId ?? ''}:${teamId}:${userId}`
 *   - Web: Clerk userId
 *   - MCP: api-key-derived actor id
 *
 * Storage is Prisma `Session.threadContext` JSON for now. Phase 9
 * moves the conversation log to a dedicated append-only table.
 */

export interface ConversationTurn {
  at: string; // ISO
  role: 'user' | 'agent' | 'system';
  text: string;
  channel: string;
  turnId: string;
  toolCalls?: Array<{ name: string; ok: boolean }>;
}

export interface ConversationState {
  /** Max 32 turns kept inline — older ones fall off. */
  turns: ConversationTurn[];
  /** Active workflow run id + paused step. Phase 5+ already writes this. */
  activeWorkflow?: {
    runId: string;
    workflowId: string;
    pausedStepId?: string;
  };
  /** Channel-agnostic subject key. */
  subjectKey: string;
}

export interface SessionStore {
  getByActor: (args: {
    tenantId: string;
    subjectKey: string;
  }) => Promise<{ id: string; state: ConversationState } | null>;
  upsert: (args: {
    tenantId: string;
    userId: string | null;
    subjectKey: string;
    state: ConversationState;
    expiresAt?: Date | null;
  }) => Promise<{ id: string }>;
}

export const MAX_TURNS = 32;

export function appendTurn(state: ConversationState, turn: ConversationTurn): ConversationState {
  const turns = [...state.turns, turn];
  return { ...state, turns: turns.slice(-MAX_TURNS) };
}

/** Deterministic subject key derivation — keep in sync with webhook routes. */
export function subjectKeyForChannel(args: {
  channel: 'whatsapp' | 'slack' | 'web' | 'mcp' | 'email';
  whatsappBsuid?: string | null;
  whatsappPhone?: string | null;
  slackEnterpriseId?: string | null;
  slackTeamId?: string | null;
  slackUserId?: string | null;
  webUserId?: string | null;
  mcpActorId?: string | null;
  email?: string | null;
}): string | null {
  switch (args.channel) {
    case 'whatsapp':
      return args.whatsappBsuid || args.whatsappPhone || null;
    case 'slack':
      if (!args.slackTeamId || !args.slackUserId) return null;
      return `${args.slackEnterpriseId ?? ''}:${args.slackTeamId}:${args.slackUserId}`;
    case 'web':
      return args.webUserId ?? null;
    case 'mcp':
      return args.mcpActorId ?? null;
    case 'email':
      return args.email?.toLowerCase().trim() ?? null;
    default:
      return null;
  }
}

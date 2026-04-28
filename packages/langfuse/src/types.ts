/**
 * @sendero/langfuse/types — Shared observability types
 */

export type AgentType =
  | 'sendero-conversation' // main dispatch agent turn (runAgentTurn)
  | 'sendero-chat' // streaming chat surface (/api/agent/chat)
  | 'sendero-slack' // Slack channel adapter
  | 'sendero-whatsapp' // WhatsApp channel adapter
  | 'sendero-mcp' // MCP server tool call
  | 'sendero-ocr' // document scanning / OCR
  | 'sendero-stamp-gen' // NFT stamp image + caption generation
  | 'sendero-inbox-rewrite' // inbox message rewrite
  | 'hitl-approval' // human-in-the-loop booking approval
  | 'llm-judge' // LLM-as-a-judge evaluator
  | (string & {});

export type Surface = 'app-api' | 'agent-turn' | 'mcp' | 'slack' | 'whatsapp' | 'email' | 'web';

export type TriggerSource = 'user' | 'webhook' | 'cron' | 'system' | 'slack' | 'whatsapp' | 'mcp';

export interface TraceMetadata {
  /** Optional — anonymous turns / system jobs may have no user. */
  userId?: string;
  tenantId: string;
  sessionId?: string;
  model?: string;
  trigger: TriggerSource;
  surface: Surface;
  channel?: string;
  tripId?: string;
  turnId?: string;
  parentTraceId?: string;
  toolCallCount?: number;
}

export interface TraceResult<T> {
  result: T;
  traceId: string;
  observationId?: string;
}

export type ScoreDataType = 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL';

export interface ScoreInput {
  traceId: string;
  name: string;
  value: number | boolean | string;
  dataType: ScoreDataType;
  comment?: string;
  observationId?: string;
}

export interface EvaluateParams {
  traceId: string;
  input: string;
  output: string;
  context?: string;
  evaluators?: string[];
}

export interface EvaluatorConfig {
  name: string;
  scoreName: string;
  scoreDataType: ScoreDataType;
  systemPrompt: string;
}

export interface ScoreResult {
  name: string;
  value: number | boolean | string;
  dataType: ScoreDataType;
  comment?: string;
}

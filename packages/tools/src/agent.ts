/**
 * Shared AI router — `routeToAgent(text, opts)`.
 *
 * One LLM entrypoint for every non-streaming surface (WhatsApp, Slack,
 * Discord, cron jobs, CLI, tests). Uses the AI SDK's `generateText`
 * with tool-calling so the model can reach into the full
 * `@sendero/tools` registry before returning a single final string.
 *
 * The Next.js web chat still uses `streamText` directly (it needs
 * token-by-token streaming for the chat UI). Everything else routes
 * here.
 *
 * Provider selection mirrors the web chat exactly:
 *   1. AI_PROVIDER env (explicit override)
 *   2. ANTHROPIC_API_KEY → Claude 3.5 Sonnet
 *   3. OPENAI_API_KEY → GPT-4o
 */

import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { toolList } from './index';
import { buildAiSdkTools } from './adapters/ai-sdk';
import type { ToolContext, ToolDef } from './types';

export interface PickedModel {
  model: any;
  label: string;
}

export function pickModel(): PickedModel | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (forced === 'openai' && hasOpenAI)
    return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  if (forced === 'anthropic' && hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  if (hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  if (hasOpenAI) return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  return null;
}

/**
 * Short system prompt tuned for non-UI surfaces (no "don't duplicate
 * the UI" rules — WhatsApp / Slack / Discord have no Stage panel).
 * The web chat passes its own richer prompt via `systemPrompt`.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Sendero, a B2B2C AI travel agent running on Circle's Arc L2.

You book flights and hotels via Duffel, and every booking settles on-chain
via an ERC-8183 job backed by USDC escrow. You have an ERC-8004 agent
identity and an accumulating reputation score.

Available tools cover:
  - search_flights / book_flight / search_hotels
  - check_treasury, gateway_balance, gateway_transfer
  - swap_tokens, send_tokens, bridge_to_arc, swap_and_bridge
  - settle_split (atomic commission fan-out)

You're speaking over a messaging surface (WhatsApp, Slack, Discord).
Keep replies SHORT (≤3 sentences unless the user asks for detail). Quote
tx hashes with https://testnet.arcscan.app/tx/<hash> when relevant. Do
not dump raw JSON — summarize it. When calling a tool, narrate one short
line ("Searching flights…") so the user knows something is happening.

Today's date: ${new Date().toISOString().split('T')[0]}.`;

export interface RouteAgentOptions {
  /** Override the default tool set (mainly for tests / scoped surfaces). */
  tools?: ToolDef[];
  /** Override the default system prompt. */
  systemPrompt?: string;
  /** Per-request context (e.g. signed-in traveler on WhatsApp). */
  ctx?: ToolContext;
  /** Max tool-call steps before forcing a final text reply. Default 6. */
  maxSteps?: number;
}

export interface RouteAgentResult {
  text: string;
  steps: number;
  provider: string;
  toolsCalled: string[];
}

/**
 * Run a single-shot agent round over `text` with tool-calling enabled.
 * Returns the final assistant text (stringified, ready to send over a
 * webhook) plus trace info for logging.
 */
export async function routeToAgent(
  text: string,
  opts: RouteAgentOptions = {},
): Promise<RouteAgentResult> {
  const picked = pickModel();
  if (!picked) {
    return {
      text:
        'AI is not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the edge worker.',
      steps: 0,
      provider: 'none',
      toolsCalled: [],
    };
  }

  const tools = buildAiSdkTools(opts.tools ?? toolList, opts.ctx ?? {});

  const result = await generateText({
    model: picked.model,
    system: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt: text,
    tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 6),
    maxRetries: 2,
  });

  // AI SDK v6: `steps` is an array of individual generation steps, each
  // may include toolCalls. Collect every tool name that was invoked so
  // the caller can log / observe.
  const toolsCalled: string[] = [];
  for (const step of (result as any).steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      if (call.toolName) toolsCalled.push(call.toolName);
    }
  }

  return {
    text: result.text?.trim() || '(agent returned no text)',
    steps: (result as any).steps?.length ?? 0,
    provider: picked.label,
    toolsCalled,
  };
}

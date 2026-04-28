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
 * Provider selection mirrors the web stack:
 *   1. AI_PROVIDER env (explicit override: google | anthropic | openai)
 *   2. Vercel AI Gateway when `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` →
 *      `google/gemini-3-flash` (Gemini-first; see root README)
 *   3. Else direct cascade: **Gemini** (GOOGLE_GENERATIVE_AI_API_KEY or
 *      GEMINI_API_KEY) → **OpenAI** → **Anthropic**
 */

import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { aiTelemetryConfig } from '@sendero/langfuse';
import { toolList } from './index';
import { buildAiSdkTools } from './adapters/ai-sdk';
import type { ToolContext, ToolDef } from './types';

export interface PickedModel {
  model: any;
  label: string;
}

function googleGenerativeAiKey(): string | undefined {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
}

function gatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

export function pickModel(): PickedModel | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const gKey = googleGenerativeAiKey();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (forced === 'openai' && hasOpenAI) return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  if (forced === 'anthropic' && hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  if (forced === 'google' && gKey) {
    const google = createGoogleGenerativeAI({ apiKey: gKey });
    return { model: google('gemini-2.5-flash'), label: 'google:gemini-2.5-flash' };
  }

  if (gatewayConfigured()) {
    return { model: 'google/gemini-3-flash', label: 'gateway:google/gemini-3-flash' };
  }

  if (gKey) {
    const google = createGoogleGenerativeAI({ apiKey: gKey });
    return { model: google('gemini-2.5-flash'), label: 'google:gemini-2.5-flash' };
  }
  if (hasOpenAI) return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  if (hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  return null;
}

/**
 * Short system prompt tuned for non-UI surfaces (no "don't duplicate
 * the UI" rules — WhatsApp / Slack / Discord have no Stage panel).
 * The web chat passes its own richer prompt via `systemPrompt`.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Sendero, a B2B2C AI travel agent running on Circle's Arc L2.

You book flights and hotels through first-party supplier integrations, and every booking settles on-chain
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
  opts: RouteAgentOptions = {}
): Promise<RouteAgentResult> {
  const picked = pickModel();
  if (!picked) {
    return {
      text: 'AI is not configured. Set AI_GATEWAY_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY, or OPENAI_API_KEY, or ANTHROPIC_API_KEY on the edge worker.',
      steps: 0,
      provider: 'none',
      toolsCalled: [],
    };
  }

  const tools = buildAiSdkTools(opts.tools ?? toolList, opts.ctx ?? {});

  const baseArgs = {
    model: picked.model,
    system: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    prompt: text,
    tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 6),
    maxRetries: 2,
    experimental_telemetry: aiTelemetryConfig('sendero-conversation', {
      surface: 'app-api',
      trigger: 'user',
      model: picked.label,
      scope: 'route-to-agent',
    }),
  };

  const result =
    typeof picked.model === 'string' && gatewayConfigured()
      ? await generateText({
          ...baseArgs,
          providerOptions: {
            gateway: { order: ['google', 'anthropic', 'openai'] },
          },
        })
      : await generateText(baseArgs);

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

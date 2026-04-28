/**
 * Inbox Support Writing Assistant — `rewrite()` endpoint.
 *
 * Takes a support agent's draft + a rewrite mode + conversation context
 * (customer, trip, channel, locale) and returns a polished rewrite in
 * the traveler's language. Intended to be cheap and fast: runs on the
 * `cheap` tier (Gemini Flash Lite → Haiku → GPT-mini) through the
 * existing Vercel AI Gateway + direct-provider cascade.
 *
 * Cached in-process by sha256 of the input + mode + locale + channel +
 * brand voice (5 min TTL, 256-entry cap). Repeated grammar/polish hits
 * on the same draft stay free.
 */

import { createHash } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { openai } from '@ai-sdk/openai';
import {
  buildProviderOptions,
  directProviderCascade,
  gatewayConfigured,
  gatewayErrorAllowsDirectRetry,
  geminiDirectModelId,
  googleGenerativeAiKey,
  selectModel,
  vertexLocation,
  vertexProject,
} from '@sendero/agent';
import { aiTelemetryConfig } from '@sendero/langfuse';
import { getLocaleSlice, renderLocaleSlicePrompt } from '@sendero/locale';
import type { RewriteMode, RewriteRequest, RewriteResponse } from '@sendero/ui/tiptap';
import { generateText, type LanguageModel } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

const DEFAULT_BRAND_VOICE = 'calm, premium, helpful, concise — editorial travel guide voice';

// ---------- cache ----------

interface CacheEntry {
  output: string;
  ts: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 256;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.output;
}

function cacheSet(key: string, output: string): void {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry — Map iteration is insertion order.
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { output, ts: Date.now() });
}

function cacheKey(req: RewriteRequest): string {
  const { message, mode, context } = req;
  const parts = [
    'v1',
    mode,
    context.locale,
    context.targetLocale ?? '',
    context.channel,
    context.brandVoice ?? DEFAULT_BRAND_VOICE,
    context.tripStatus ?? '',
    context.customerName ?? '',
    message,
  ].join('|');
  return createHash('sha256').update(parts).digest('hex');
}

// ---------- prompts ----------

const MODE_INSTRUCTIONS: Record<RewriteMode, string> = {
  grammar:
    'Fix grammar, punctuation, and clarity only. Preserve voice, length, and the ORIGINAL language exactly. Do not translate.',
  shorter:
    'Rewrite to be ~40% shorter while keeping every meaningful fact. Preserve the original language. Keep it scannable.',
  warmer:
    'Rewrite to feel warmer and more personal. Use the customer name when natural. Stay concise. Preserve the original language.',
  more_professional:
    'Rewrite in a more professional, travel-consultant register. Avoid stiffness or legalese. Preserve the original language.',
  translate:
    'Translate the message into the target locale. Preserve tone, proper nouns (airports, IATA codes, hotel names, PNRs), and any dates/times exactly. Use the travel vocabulary appropriate to the target market.',
  whatsapp:
    'Rewrite as a WhatsApp-native message. Short sentences, line breaks between ideas, at most one relevant emoji, no salutation stacks, no email sign-off. Preserve the original language.',
  explain_delay:
    'Rewrite as a calm, empathetic explanation of a delay or disruption. Acknowledge the impact, explain what is happening in one sentence, commit to a concrete next step with a timeframe. Preserve the original language.',
  escalate:
    'Rewrite as a handoff-to-human tone: apologize briefly for the friction, commit to escalating to a senior agent, and set an expectation for follow-up. Preserve the original language.',
};

function buildSystemPrompt(context: RewriteRequest['context']): string {
  const brandVoice = context.brandVoice ?? DEFAULT_BRAND_VOICE;
  const slice = getLocaleSlice(context.locale);
  const localeBlock = renderLocaleSlicePrompt(slice);

  return [
    'You are Sendero — an agent-native travel booking platform helping a human support agent write a better reply to a traveler.',
    `Brand voice: ${brandVoice}.`,
    'Rules:',
    '- Return ONLY the rewritten message. No preamble, no quotes, no explanations.',
    '- Never invent facts, times, prices, PNRs, or airport codes that were not in the input.',
    '- Preserve URLs, IATA codes, PNRs, dates, and prices exactly.',
    '- Keep the length proportional to the input unless the mode requires otherwise.',
    '',
    localeBlock,
  ].join('\n');
}

function buildUserPrompt(req: RewriteRequest): string {
  const { message, mode, context } = req;
  const contextLines: string[] = [];
  if (context.customerName) contextLines.push(`Customer: ${context.customerName}`);
  if (context.tripStatus) contextLines.push(`Trip status: ${context.tripStatus}`);
  contextLines.push(`Channel: ${context.channel}`);
  if (mode === 'translate') {
    if (!context.targetLocale) {
      throw new Error('translate mode requires context.targetLocale');
    }
    contextLines.push(`Source locale: ${context.locale}`);
    contextLines.push(`Target locale: ${context.targetLocale}`);
  } else {
    contextLines.push(`Reply language: ${context.locale}`);
  }

  return [
    `Action: ${MODE_INSTRUCTIONS[mode]}`,
    '',
    contextLines.join('\n'),
    '',
    'Draft to rewrite:',
    message,
  ].join('\n');
}

// ---------- cascade ----------

type Picked =
  | { kind: 'gateway'; model: string }
  | { kind: 'direct'; model: LanguageModel; label: string };

function buildCascade(): Picked[] {
  const out: Picked[] = [];
  if (gatewayConfigured()) {
    const { model } = selectModel({ tier: 'cheap' });
    out.push({ kind: 'gateway', model });
  }
  for (const direct of directProviderCascade('cheap')) {
    const [provider, modelId] = direct.split('/') as [string, string];
    if (provider === 'vertex') {
      const project = vertexProject();
      if (!project) continue;
      const vertex = createVertex({ project, location: vertexLocation() });
      out.push({
        kind: 'direct',
        model: vertex(geminiDirectModelId(`google/${modelId}`)),
        label: direct,
      });
    } else if (provider === 'google') {
      const key = googleGenerativeAiKey();
      if (!key) continue;
      const google = createGoogleGenerativeAI({ apiKey: key });
      out.push({
        kind: 'direct',
        model: google(geminiDirectModelId(direct)),
        label: direct,
      });
    } else if (provider === 'openai') {
      out.push({ kind: 'direct', model: openai(modelId), label: direct });
    } else if (provider === 'anthropic') {
      out.push({ kind: 'direct', model: anthropic(modelId), label: direct });
    }
  }
  return out;
}

async function runCascade(system: string, prompt: string): Promise<string> {
  const cascade = buildCascade();
  if (cascade.length === 0) {
    throw new Error('No AI credentials configured for rewrite.');
  }
  let lastError: unknown = null;
  for (const pick of cascade) {
    try {
      const providerOptions = pick.kind === 'gateway' ? buildProviderOptions('cheap') : undefined;
      const result = await generateText({
        model: pick.kind === 'gateway' ? pick.model : pick.model,
        system,
        prompt,
        temperature: 0.2,
        maxOutputTokens: 600,
        maxRetries: 0,
        providerOptions,
        experimental_telemetry: aiTelemetryConfig('sendero-inbox-rewrite', {
          surface: 'app-api',
          trigger: 'user',
          scope: 'inbox-rewrite',
        }),
      });
      const text = (result.text ?? '').trim().replace(/^["']|["']$/g, '');
      if (text) return text;
      lastError = new Error('Empty output');
    } catch (err) {
      lastError = err;
      // Only fall through on recognisable gateway failures or when trying
      // direct-provider candidates. Any other error is likely a genuine
      // model error — surface it.
      if (pick.kind === 'gateway' && !gatewayErrorAllowsDirectRetry(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All providers failed');
}

// ---------- route ----------

function isRewriteMode(v: unknown): v is RewriteMode {
  return (
    typeof v === 'string' &&
    [
      'grammar',
      'shorter',
      'warmer',
      'more_professional',
      'translate',
      'whatsapp',
      'explain_delay',
      'escalate',
    ].includes(v)
  );
}

export async function POST(req: NextRequest) {
  let body: RewriteRequest;
  try {
    body = (await req.json()) as RewriteRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, mode, context } = body;
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!isRewriteMode(mode)) {
    return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
  }
  if (!context || typeof context.locale !== 'string' || !context.locale) {
    return NextResponse.json({ error: 'context.locale is required' }, { status: 400 });
  }
  if (mode === 'translate' && !context.targetLocale) {
    return NextResponse.json(
      { error: 'translate mode requires context.targetLocale' },
      { status: 400 }
    );
  }

  const key = cacheKey(body);
  const cached = cacheGet(key);
  const locale = mode === 'translate' ? (context.targetLocale as string) : context.locale;
  if (cached) {
    const res: RewriteResponse = { output: cached, mode, locale };
    return NextResponse.json(res);
  }

  try {
    const system = buildSystemPrompt(context);
    const prompt = buildUserPrompt(body);
    const output = await runCascade(system, prompt);
    cacheSet(key, output);
    const res: RewriteResponse = { output, mode, locale };
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rewrite failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

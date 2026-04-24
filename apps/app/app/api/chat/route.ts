/**
 * Sendero agent chat — streaming AI with on-chain tool calling.
 *
 * Tools are defined once in `lib/tools/` and adapted to the AI SDK
 * via `buildAiSdkTools`. The MCP server at /api/mcp reads the same
 * registry — no duplication.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { openai } from '@ai-sdk/openai';
import {
  buildProviderOptions,
  buildSystemPrompt,
  directProviderCascade,
  gatewayConfigured,
  gatewayErrorAllowsDirectRetry,
  geminiDirectModelId,
  googleGenerativeAiKey,
  type ModelTier,
  renderWorkflowsBlock,
  selectModel,
  SENDERO_SOUL,
  vertexLocation,
  vertexProject,
} from '@sendero/agent';
import { detectLocale, getLocaleSlice, LOCALE_COOKIE_NAME } from '@sendero/locale';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { buildRunWorkflowTool, listWorkflows, listWorkflowsTool } from '@sendero/workflows';
import {
  convertToModelMessages,
  generateText,
  type LanguageModel,
  stepCountIs,
  streamText,
} from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const WEB_CHAT_RULES = `## Web console rules

You book flights for corporate travelers through first-party supplier integrations, and every booking is
settled on-chain via an ERC-8183 job backed by USDC escrow. You have an
ERC-8004 agent identity and an accumulating reputation score.

Booking flow — ALWAYS in this order:
  1. search_flights   — confirm origin/destination/date with the user first
  2. book_flight      — after the user picks an offer; issues a real PNR

CRITICAL — don't duplicate the UI:
  • After search_flights returns, the Stage already renders every offer as a
    rich card. DO NOT list airline/price/duration in the chat. Reply in ONE
    short sentence pointing the user to the Stage ("Three premium-economy
    options on the right — click Hold seat to book.") and stop.
  • After book_flight returns a PNR, the UI renders a HoldCard and a
    Settlement panel. DO NOT recap the price or PNR. Reply in ONE sentence
    telling the user to sign the three userOps in the Settlement panel to
    finalize on Arc.
  • Do not try to call any settle tool — the UI drives the user through the
    three passkey-signed user operations itself.

Hotels are a separate flow. Use search_hotels when the user asks for
lodging. The Stage renders up to six property cards — DO NOT list them in
the chat, same rule as flights.

Treasury rebalance tools (Sendero corporate wallet on Arc):
  • check_treasury         — read current USDC + EURC balances
  • gateway_balance        — unified USDC across every Gateway testnet
  • gateway_transfer       — sub-500ms burn+mint between Gateway chains
  • swap_tokens            — USDC ↔ EURC on Arc via Circle App Kit
  • send_tokens            — transfer USDC/EURC to any Arc address
  • bridge_to_arc          — CCTP v2 bridge into Arc (slower than Gateway)
  • swap_and_bridge        — composed: CCTP into Arc then swap to EURC
  • settle_split           — atomic commission fan-out on Arc

Keep every response under 2 sentences unless the user asks a question. When
you call a tool, a single clause like "Searching flights…" is enough.

Today's date: ${new Date().toISOString().split('T')[0]}.`;

type Picked = { model: LanguageModel | string; label: string; tier: ModelTier };

/**
 * Short in-memory cooldown after a gateway-level failure (e.g. "Free
 * credits temporarily restricted"). During the cooldown we skip the
 * gateway entirely and go straight to the direct-provider cascade, so
 * subsequent chat turns don't re-probe a known-broken gateway.
 *
 * 60s is long enough to weather the kind of bursty rate-limit Vercel
 * imposes, short enough that recovery is quick. Per-process only —
 * serverless cold starts reset it, which is fine.
 */
let gatewayBrokenUntil = 0;

function resolveDirectPickeds(tier: ModelTier): Picked[] {
  const picks: Picked[] = [];
  for (const direct of directProviderCascade(tier)) {
    const [provider, modelId] = direct.split('/') as [string, string];
    if (provider === 'vertex') {
      const project = vertexProject();
      if (!project) continue;
      // Credentials resolution, two paths:
      //   - Local: the SDK auto-discovers ADC from
      //     ~/.config/gcloud/application_default_credentials.json
      //     (via `gcloud auth application-default login`). Pass nothing.
      //   - Vercel: GOOGLE_APPLICATION_CREDENTIALS_JSON holds a SA JSON
      //     pasted via `vercel env add`. google-auth-library does NOT
      //     auto-read that env, so we parse and pass inline. Parse errors
      //     fall through to the next provider — probe surface is robust.
      let googleAuthOptions: Parameters<typeof createVertex>[0]['googleAuthOptions'];
      const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (saJson) {
        try {
          googleAuthOptions = { credentials: JSON.parse(saJson) };
        } catch (err) {
          console.warn(
            '[chat] GOOGLE_APPLICATION_CREDENTIALS_JSON is set but not valid JSON, skipping vertex',
            err instanceof Error ? err.message : err
          );
          continue;
        }
      }
      const vertex = createVertex({
        project,
        location: vertexLocation(),
        googleAuthOptions,
      });
      // `modelId` here is already the bare Gemini name (e.g. gemini-3-flash)
      // because directProviderCascade emits `vertex/<modelId>` for us.
      picks.push({
        model: vertex(geminiDirectModelId(`google/${modelId}`)),
        label: `direct:${direct}`,
        tier,
      });
    } else if (provider === 'google') {
      const key = googleGenerativeAiKey();
      if (!key) continue;
      const google = createGoogleGenerativeAI({ apiKey: key });
      picks.push({
        model: google(geminiDirectModelId(direct)),
        label: `direct:${direct}`,
        tier,
      });
    } else if (provider === 'anthropic') {
      picks.push({ model: anthropic(modelId), label: `direct:${direct}`, tier });
    } else if (provider === 'openai') {
      picks.push({ model: openai(modelId), label: `direct:${direct}`, tier });
    }
  }
  return picks;
}

/**
 * Ordered cascade: [gateway (if configured and not on cooldown),
 * ...direct-provider cascade]. The chat route probes each in order and
 * streams with the first one that responds to a 4-token probe.
 */
function pickModelCascade(tier: ModelTier = 'fast'): Picked[] {
  const picks: Picked[] = [];
  const gatewayOk = gatewayConfigured() && Date.now() >= gatewayBrokenUntil;
  if (gatewayOk) {
    const { model } = selectModel({ tier });
    picks.push({ model, label: `gateway:${model}`, tier });
  }
  picks.push(...resolveDirectPickeds(tier));
  return picks;
}

/**
 * Tiny probe: burn ≤ 4 tokens to confirm the model responds at all.
 * This catches the Vercel AI Gateway "Free credits restricted" family
 * (and similar provider-account-level failures) before we start
 * streaming bytes to the client, where an error would surface as a
 * confusing inline assistant message.
 */
async function probeModel(pick: Picked): Promise<{ ok: true } | { ok: false; err: unknown }> {
  try {
    const providerOptions =
      typeof pick.model === 'string' ? buildProviderOptions(pick.tier) : undefined;
    await generateText({
      model: pick.model,
      prompt: 'ok',
      maxOutputTokens: 16,
      maxRetries: 0,
      providerOptions,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

interface ChatBody {
  messages: Parameters<typeof convertToModelMessages>[0];
  traveler?: { name?: string; email?: string; phone?: string };
  context?: Record<string, string | number | boolean | null | object>;
  tier?: ModelTier;
  locale?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const messages = body.messages;
  const traveler = body.traveler;
  const locale = body.locale ?? requestLocale(req);

  const runtimeContextJson = body.context ? JSON.stringify(body.context, null, 2) : undefined;

  // Chat tier defaults to 'fast' (sonnet-class) for responsive replies.
  // A trailing body.tier override lets power users force a smart/cheap turn.
  const requestedTier: ModelTier = body.tier ?? 'fast';
  const cascade = pickModelCascade(requestedTier);
  if (cascade.length === 0) {
    // Plain text because useChat renders the raw body as `error.message`.
    // Give the operator a human sentence, not a JSON blob.
    return new Response(
      'The AI agent isn’t configured yet. Set AI_GATEWAY_API_KEY or any of GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY and try again.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // Probe the cascade in order: gateway → Google → OpenAI → Anthropic.
  // First model that round-trips a 4-token call wins. A gateway-level
  // failure arms the 60s cooldown so follow-on turns skip the probe and
  // go direct. Per-candidate failure is recorded for the final error
  // surface if every provider falls over.
  let picked: Picked | null = null;
  const failures: Array<{ label: string; message: string }> = [];
  for (const candidate of cascade) {
    const probe = await probeModel(candidate);
    if (probe.ok === true) {
      picked = candidate;
      break;
    }
    const err = probe.err;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push({ label: candidate.label, message: msg });
    console.warn(`[chat] probe failed for ${candidate.label}: ${msg}`);
    if (candidate.label.startsWith('gateway:') && gatewayErrorAllowsDirectRetry(err)) {
      gatewayBrokenUntil = Date.now() + 60_000;
    }
  }
  if (!picked) {
    const tried = failures.map(f => f.label).join(', ') || 'none';
    const lastMessage = failures[failures.length - 1]?.message ?? 'no provider configured';
    console.error(`[chat] all providers failed; tried=${tried}; last=${lastMessage}`, failures);
    // Production: generic message — don't leak provider error text to
    // end users. Dev / preview / local: include the per-candidate
    // reason so the operator immediately sees "AI_GATEWAY_API_KEY is
    // invalid" or "model not available" without digging through logs.
    const isProd = (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === 'production';
    const body = isProd
      ? 'All AI providers are unavailable right now — gateway, Google, OpenAI, and Anthropic all failed to respond. Please try again in a minute. If this keeps happening, check the provider credit balances.'
      : [
          'All AI providers failed. Per-candidate reasons (dev-mode diagnostic — prod shows a generic message):',
          '',
          ...failures.map(f => `  • ${f.label}\n    ${f.message}`),
          '',
          'If gateway credits exist, check AI_GATEWAY_API_KEY is the one for the billed workspace and that the model is enabled on your gateway.',
        ].join('\n');
    return new Response(body, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Workflow orchestration tools — expose `list_workflows` + `run_workflow`
  // alongside the leaf tools so the model can either chain manually or
  // dispatch a full multi-step plan in one call. The runner needs the
  // same per-request tool registry the LLM uses, so the factory closes
  // over the freshly built `tools` map below.
  const baseTools = buildAiSdkTools(toolList, { traveler });
  const runWorkflowTool = buildRunWorkflowTool({
    resolveTools: () => {
      const registry: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
      for (const def of toolList) {
        registry[def.name] = args => def.handler(args, { traveler });
      }
      return registry;
    },
  });
  const workflowTools = buildAiSdkTools([listWorkflowsTool, runWorkflowTool], { traveler });
  const tools = { ...baseTools, ...workflowTools };
  const converted = await convertToModelMessages(messages);

  console.log(`[chat] using ${picked.label}`);

  // Same section-based builder @sendero/agent uses for dispatch — ensures
  // every channel sees the workflow catalog as the canonical orchestration
  // surface, not ad-hoc tool chains.
  const systemPrompt = buildSystemPrompt({
    persona: `${SENDERO_SOUL}\n\n${WEB_CHAT_RULES}`,
    locale,
    localeSlice: getLocaleSlice(locale),
    channelHint:
      'Web console. The right-side Stage renders offer cards, hold cards, and settlement panels, so keep chat replies concise and do not duplicate visible UI.',
    runtimeContext: runtimeContextJson,
    workflowCatalog: renderWorkflowsBlock(
      listWorkflows().map(w => ({ id: w.id, label: w.label, description: w.description }))
    ),
  });

  const onError: Parameters<typeof streamText>[0]['onError'] = event => {
    const err = event?.error;
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
    console.error(`[chat] ${picked.label} error:`, msg);
  };

  const providerOptions =
    typeof picked.model === 'string' ? buildProviderOptions(picked.tier) : undefined;

  const result = streamText({
    model: picked.model,
    system: systemPrompt,
    messages: converted,
    tools,
    stopWhen: stepCountIs(6),
    maxRetries: 2,
    providerOptions,
    onError,
  });

  return result.toUIMessageStreamResponse({
    headers: { 'X-AI-Provider': picked.label },
  } as any);
}

function requestLocale(req: NextRequest): string {
  return detectLocale({
    cookie: req.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: req.headers.get('x-sendero-locale') ?? req.headers.get('accept-language'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
  });
}

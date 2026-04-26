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
import { auth } from '@clerk/nextjs/server';
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
  SENDERO_SOUL,
  selectModel,
  vertexLocation,
  vertexProject,
} from '@sendero/agent';
import { prisma } from '@sendero/database';
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

import { detectAttachmentsHint } from '@/lib/agent-attachments-hint';

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
  /**
   * Optional trip scope. When the MetaInbox is mounted at
   * `/dashboard/inbox/[tripId]`, the live wrapper threads the tripId
   * through here so the meter event written in `onFinish` carries the
   * trip in its metadata, and the SSE stream at `/api/meter/stream`
   * can fan out the row to anyone watching that trip.
   */
  tripId?: string;
  /** Channel name for the meter event metadata. Defaults to 'web'. */
  channel?: 'web' | 'whatsapp' | 'slack' | 'email' | 'mcp';
  /**
   * Stable client-side chat session id. When provided, /api/chat
   * upserts a `ChatSession` row keyed on it and persists every
   * UIMessage as a `ChatMessage`. Lets the operator re-view past
   * sessions in the CHAT MODE tab. Omitted = ephemeral turn (e.g.
   * playground / mcp callers); no row written.
   */
  chatSessionId?: string;
}

/**
 * Pull a flat text snippet out of a UIMessage parts array. Used for
 * the denormalized `ChatMessage.content` column (fast list previews
 * without rehydrating `parts` JSON) and for ChatSession.title — first
 * user message becomes the auto-title.
 */
function extractContent(message: { parts?: unknown[] }): string {
  if (!Array.isArray(message.parts)) return '';
  const out: string[] = [];
  for (const p of message.parts) {
    if (p && typeof p === 'object') {
      const part = p as { type?: string; text?: string };
      if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') {
        out.push(part.text);
      }
    }
  }
  return out.join('\n').slice(0, 4000);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const messages = body.messages;
  const traveler = body.traveler;
  const locale = body.locale ?? requestLocale(req);
  const tripId = body.tripId ?? null;
  const channel = body.channel ?? 'web';
  const chatSessionId = body.chatSessionId ?? null;

  // Resolve tenant for the meter write. Done lazily — the chat route
  // is also reachable from non-authenticated surfaces (storybook,
  // playground), so a missing session is logged + skipped, not an
  // error. Real users hit this from the Clerk-gated `/dashboard/*`
  // routes and always have an `orgId`.
  let tenantId: string | null = null;
  let userId: string | null = null;
  try {
    const session = await auth();
    if (session.orgId) {
      const tenant = await prisma.tenant.findUnique({
        where: { clerkOrgId: session.orgId },
        select: { id: true },
      });
      tenantId = tenant?.id ?? null;
    }
    if (session.userId) {
      const user = await prisma.user.findUnique({
        where: { clerkUserId: session.userId },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }
  } catch (err) {
    console.warn('[chat] tenant resolve failed; meter write will be skipped', err);
  }

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
  // Tenant flows into tool ctx so tools that mutate per-tenant data
  // (create_passenger, activate_pricing_policy, etc.) can scope their
  // writes without trusting the LLM to supply a tenantId.
  const enrichedTraveler = tenantId
    ? { ...(traveler ?? {}), tenantId, userId: userId ?? undefined }
    : traveler;
  const baseTools = buildAiSdkTools(toolList, { traveler: enrichedTraveler });
  const runWorkflowTool = buildRunWorkflowTool({
    resolveTools: () => {
      const registry: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
      for (const def of toolList) {
        registry[def.name] = args => def.handler(args, { traveler });
      }
      return registry;
    },
  });
  const workflowTools = buildAiSdkTools([listWorkflowsTool, runWorkflowTool], {
    traveler: enrichedTraveler,
  });
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
    attachmentsHint: detectAttachmentsHint(messages),
  });

  const onError: Parameters<typeof streamText>[0]['onError'] = event => {
    const err = event?.error;
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
    console.error(`[chat] ${picked.label} error:`, msg);
  };

  const providerOptions =
    typeof picked.model === 'string' ? buildProviderOptions(picked.tier) : undefined;

  // Stable per-turn id so retries de-dupe at the meter layer.
  const turnId = `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const result = streamText({
    model: picked.model,
    system: systemPrompt,
    messages: converted,
    tools,
    stopWhen: stepCountIs(6),
    maxRetries: 2,
    providerOptions,
    onError,
    // Bill the turn after the last chunk lands. `chat_reply` is the
    // canonical aggregator the rest of the system already understands
    // (matches `runAgentTurn` in @sendero/agent and the streaming
    // sibling at /api/agent/chat). The toolNames array carried in
    // metadata lets `/api/meter/stream` consumers reconstruct what the
    // agent actually did this turn — useful for the NanopayPanel
    // ledger but never trusted for pricing.
    onFinish: async finish => {
      if (!tenantId) return;
      const toolNames = (finish.toolCalls ?? []).map(t => t.toolName);

      // Persist the chat session + every UIMessage. Non-fatal: meter
      // write still runs even if this throws. Skipped when the caller
      // didn't supply a chatSessionId (mcp / playground turns).
      if (chatSessionId) {
        // Defensive: if the dev server is holding a stale Prisma
        // client (no chatSession namespace), log loudly and skip
        // instead of throwing inside the streaming callback.
        const client = prisma as typeof prisma & { chatSession?: typeof prisma.chatSession };
        if (!client.chatSession) {
          console.warn(
            '[chat] persistence skipped: Prisma client is stale (no chatSession). Restart the dev server (`bun dev`) to pick up the regenerated client.'
          );
        } else {
          try {
            // Auto-title from the first user message — first 80 chars.
            const firstUserMsg = (messages as Array<{ role?: string; parts?: unknown[] }>).find(
              m => m?.role === 'user'
            );
            const autoTitle = firstUserMsg
              ? extractContent(firstUserMsg).slice(0, 80) || null
              : null;

            await prisma.chatSession.upsert({
              where: { id: chatSessionId },
              create: {
                id: chatSessionId,
                tenantId,
                userId,
                tripId,
                title: autoTitle,
                metadata: { channel, locale },
              },
              update: {
                tripId: tripId ?? undefined,
                ...(autoTitle ? { title: autoTitle } : {}),
              },
            });

            // Find the highest createdAt we already persisted so we
            // only insert messages new since the last turn (useChat
            // re-sends the full history every turn).
            const lastPersistedCount = await prisma.chatMessage.count({
              where: { chatSessionId },
            });
            const incoming = messages as Array<{ role?: string; parts?: unknown[] }>;
            const newRows = incoming.slice(lastPersistedCount);
            if (newRows.length > 0) {
              await prisma.chatMessage.createMany({
                data: newRows.map(m => ({
                  chatSessionId,
                  role: m.role ?? 'assistant',
                  content: extractContent(m),
                  parts: (m.parts ?? []) as never,
                })),
              });
            }
            // Plus the assistant's freshly-finished response.
            if (finish.response?.messages) {
              for (const respMsg of finish.response.messages) {
                if (!respMsg) continue;
                const roleName =
                  typeof (respMsg as { role?: unknown }).role === 'string'
                    ? ((respMsg as { role: string }).role as string)
                    : 'assistant';
                const text = (() => {
                  const content = (respMsg as { content?: unknown }).content;
                  if (typeof content === 'string') return content;
                  if (Array.isArray(content)) {
                    return content
                      .map(c =>
                        c && typeof c === 'object' && 'text' in c
                          ? String((c as { text?: unknown }).text ?? '')
                          : ''
                      )
                      .join('\n');
                  }
                  return '';
                })();
                await prisma.chatMessage.create({
                  data: {
                    chatSessionId,
                    role: roleName,
                    content: text.slice(0, 4000),
                    parts: ((respMsg as { content?: unknown }).content ?? null) as never,
                  },
                });
              }
            }

            console.log(
              `[chat] chat session persisted: ${chatSessionId} (+${newRows.length} new messages)`
            );

            // Notify any subscribers (the CHAT MODE rail) so they can
            // refetch in real time without polling. Mirrors the
            // pg_notify('meter_event', …) pattern we already use for
            // the live meter stream.
            const payload = JSON.stringify({
              chatSessionId,
              tenantId,
              userId,
              tripId,
              at: new Date().toISOString(),
            });
            await prisma.$executeRaw`SELECT pg_notify('chat_session_updated', ${payload})`.catch(
              err => console.warn('[chat] pg_notify chat_session_updated failed (non-fatal)', err)
            );
          } catch (err) {
            console.error('[chat] chat session persistence failed (non-fatal):', err);
          }
        }
      }

      try {
        const row = await prisma.meterEvent.create({
          data: {
            tenantId,
            userId,
            toolName: 'chat_reply',
            // Flat $0.001 per turn for the web console until the full
            // segment-aware preflight pipeline is wired here. Real
            // pricing lives in `runAgentTurn` for dispatch + the agent
            // chat stream; this surface stays cheap-and-honest until
            // we promote it.
            priceMicroUsdc: 1_000n,
            status: 'paid',
            note: `surface=chat channel=${channel} tools=${toolNames.length}`,
            metadata: {
              channel,
              turnId,
              tripId,
              toolNames,
              surface: 'web_console_chat',
              chatSessionId,
            },
          },
          select: { id: true, at: true, priceMicroUsdc: true },
        });

        // Fan out to anyone watching the meter SSE stream.
        const payload = JSON.stringify({
          id: row.id,
          tenantId,
          tripId,
          toolName: 'chat_reply',
          toolNames,
          priceMicroUsdc: row.priceMicroUsdc.toString(),
          status: 'paid',
          at: row.at.toISOString(),
        });
        await prisma.$executeRaw`SELECT pg_notify('meter_event', ${payload})`.catch(err =>
          console.warn('[chat] pg_notify meter_event failed (non-fatal)', err)
        );

        // Settlement is intentionally batched, not inline. The cron at
        // /api/cron/settle-nanopay-batches sweeps every 5 minutes
        // (vercel.json) — gas-efficient, no nonce races on the
        // treasury EOA, predictable RPC budget. The Spend dashboard
        // surfaces pending-vs-reconciled so the operator sees what's
        // owed at any instant without waiting on chain confirmation.
      } catch (err) {
        console.error('[chat] meter write failed (non-fatal):', err);
      }
    },
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

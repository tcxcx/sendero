/**
 * GET /api/health
 *
 * Unified platform health snapshot. Segmented by subsystem so an
 * operator (or a smoke test) can spot the exact missing credential
 * instead of chasing a vague 503. Never throws — always returns a
 * structured JSON payload.
 *
 * Subsystems:
 *   agent       — LLM, tools, workflows, session store
 *   auth        — Clerk keys + webhook signing secret
 *   billing     — meter idempotency column, caps, batch scheduler
 *   channels    — WhatsApp, Slack (+ Enterprise Grid), Email, Web, MCP
 *   onchain     — Arc RPC, treasury, guest escrow, agent token id
 *   intelligence — memory + preferences + locale glossary
 *   ops         — cron, analytics, collaboration, cms
 */

import { NextResponse } from 'next/server';

import { DEFAULT_PRICING } from '@sendero/billing/pricing';
import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { SUPPORTED_LOCALES } from '@sendero/locale';
import { toolList } from '@sendero/tools';
import { listWorkflows } from '@sendero/workflows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface Subsystem {
  name: string;
  ok: boolean;
  checks: Check[];
}

export async function GET() {
  const started = Date.now();

  const [agent, auth, billing, channels, onchain, intelligence, ops] = await Promise.all([
    checkAgent(),
    checkAuth(),
    checkBilling(),
    checkChannels(),
    checkOnchain(),
    checkIntelligence(),
    checkOps(),
  ]);

  const subsystems: Subsystem[] = [agent, auth, billing, channels, onchain, intelligence, ops];
  const overall = subsystems.every(s => s.ok);

  return NextResponse.json(
    {
      status: overall ? 'ok' : 'degraded',
      latencyMs: Date.now() - started,
      subsystems,
    },
    { status: overall ? 200 : 207 }
  );
}

// ─── subsystem checks ───────────────────────────────────────────────

async function checkAgent(): Promise<Subsystem> {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  const anthropicKey = env.anthropicApiKey();
  const openaiKey = process.env.OPENAI_API_KEY;
  const anyLlmKey = Boolean(gatewayKey || oidc || anthropicKey || openaiKey);
  const checks: Check[] = [
    {
      name: 'llm_credential',
      ok: anyLlmKey,
      detail: gatewayKey
        ? 'Vercel AI Gateway (preferred) — providerOptions.gateway.order drives fallback'
        : oidc
          ? 'Vercel OIDC — gateway auth via platform token'
          : anthropicKey && openaiKey
            ? 'direct BYOK: Anthropic + OpenAI both set — used as fallbacks'
            : anthropicKey
              ? 'direct: ANTHROPIC_API_KEY only — add AI_GATEWAY_API_KEY for fallback coverage'
              : openaiKey
                ? 'direct: OPENAI_API_KEY only — add AI_GATEWAY_API_KEY for fallback coverage'
                : 'set AI_GATEWAY_API_KEY (preferred) or any direct provider key',
    },
    {
      name: 'tool_catalog',
      ok: toolList.length > 0,
      detail: `${toolList.length} tools registered`,
    },
    {
      name: 'workflow_catalog',
      ok: listWorkflows().length > 0,
      detail: `${listWorkflows().length} workflows registered`,
    },
    await dbColumnCheck({
      name: 'session_subject_key_column',
      table: 'sessions',
      column: 'subjectKey',
    }),
  ];
  return { name: 'agent', ok: checks.every(c => c.ok), checks };
}

async function checkAuth(): Promise<Subsystem> {
  const checks: Check[] = [
    {
      name: 'clerk_secret_key',
      ok: Boolean(process.env.CLERK_SECRET_KEY),
      detail: process.env.CLERK_SECRET_KEY
        ? undefined
        : 'set CLERK_SECRET_KEY from Clerk Dashboard → API keys',
    },
    {
      name: 'clerk_publishable_key',
      ok: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
      detail: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        ? undefined
        : 'set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY from Clerk Dashboard → API keys',
    },
    {
      name: 'clerk_webhook_secret',
      ok: Boolean(process.env.CLERK_WEBHOOK_SECRET),
      detail: process.env.CLERK_WEBHOOK_SECRET
        ? undefined
        : 'set CLERK_WEBHOOK_SECRET (svix signing secret from Clerk Dashboard → Webhooks)',
    },
  ];
  return { name: 'auth', ok: checks.every(c => c.ok), checks };
}

async function checkBilling(): Promise<Subsystem> {
  const pricingRows = Object.keys(DEFAULT_PRICING).length;
  const checks: Check[] = [
    {
      name: 'pricing_catalog',
      ok: pricingRows > 0,
      detail: `${pricingRows} metered actions`,
    },
    await dbColumnCheck({
      name: 'meter_idempotency_column',
      table: 'meter_events',
      column: 'idempotencyKey',
    }),
    {
      name: 'cron_secret',
      ok: Boolean(process.env.CRON_SECRET),
      detail: process.env.CRON_SECRET
        ? 'set — Vercel cron can authorize'
        : 'set CRON_SECRET for the nanopay batch scheduler',
    },
    {
      name: 'invoice_signing_secret',
      ok: Boolean(process.env.INVOICE_SIGNING_SECRET),
      detail: process.env.INVOICE_SIGNING_SECRET
        ? 'set — platform invoice HMAC signatures'
        : 'set INVOICE_SIGNING_SECRET for platform invoice signing',
    },
    {
      name: 'vercel_blob',
      ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      detail: process.env.BLOB_READ_WRITE_TOKEN
        ? 'set — Vercel Blob storage for invoice PDFs'
        : 'set BLOB_READ_WRITE_TOKEN for invoice PDF storage',
    },
  ];
  return { name: 'billing', ok: checks.every(c => c.ok), checks };
}

async function checkChannels(): Promise<Subsystem> {
  const checks: Check[] = [
    {
      name: 'whatsapp_app_secret',
      ok: Boolean(env.whatsappAppSecret()),
      detail: env.whatsappAppSecret() ? undefined : 'set WHATSAPP_APP_SECRET',
    },
    {
      name: 'whatsapp_verify_token',
      ok: Boolean(env.whatsappVerifyToken()),
      detail: env.whatsappVerifyToken() ? undefined : 'set WHATSAPP_VERIFY_TOKEN',
    },
    {
      name: 'whatsapp_access_token',
      ok: Boolean(env.whatsappAccessToken()),
      detail: env.whatsappAccessToken()
        ? undefined
        : 'set WHATSAPP_ACCESS_TOKEN (or per-tenant via /onboarding/agency)',
    },
    {
      name: 'slack_signing_secret',
      ok: Boolean(env.slackSigningSecret()),
      detail: env.slackSigningSecret() ? undefined : 'set SLACK_SIGNING_SECRET',
    },
    {
      name: 'slack_oauth',
      ok: Boolean(env.slackClientId() && env.slackClientSecret() && env.slackRedirectUri()),
      detail:
        env.slackClientId() && env.slackClientSecret() && env.slackRedirectUri()
          ? undefined
          : 'set SLACK_CLIENT_ID + SLACK_CLIENT_SECRET + SLACK_REDIRECT_URI for /onboarding/corporate',
    },
    {
      name: 'meta_embedded_signup',
      ok: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      detail:
        process.env.META_APP_ID && process.env.META_APP_SECRET
          ? undefined
          : 'optional — set META_APP_ID + META_APP_SECRET for WABA Embedded Signup',
    },
  ];
  return {
    name: 'channels',
    ok: checks.every(c => c.ok || c.name === 'meta_embedded_signup'),
    checks,
  };
}

async function checkOnchain(): Promise<Subsystem> {
  const checks: Check[] = [
    {
      name: 'arc_rpc',
      ok: Boolean(env.arcRpcUrl()),
      detail: env.arcRpcUrl(),
    },
    {
      name: 'treasury_private_key',
      ok: Boolean(env.treasuryPrivateKey()),
      detail: env.treasuryPrivateKey() ? undefined : 'set TREASURY_PRIVATE_KEY',
    },
    {
      name: 'guest_escrow_address',
      ok: Boolean(env.senderoGuestEscrowAddress()),
      detail: env.senderoGuestEscrowAddress() ?? 'set SENDERO_GUEST_ESCROW',
    },
    {
      name: 'agent_token_id',
      ok: Boolean(env.senderoAgentTokenId()),
      detail: env.senderoAgentTokenId() ?? 'set SENDERO_AGENT_TOKEN_ID',
    },
    {
      name: 'sendero_treasury_address',
      ok: Boolean(process.env.SENDERO_TREASURY_ADDRESS),
      detail:
        process.env.SENDERO_TREASURY_ADDRESS ??
        'set SENDERO_TREASURY_ADDRESS (nanopay batch settlement destination)',
    },
    {
      name: 'circle_api',
      ok: Boolean(env.circleApiKey() && env.circleEntitySecret()),
      detail:
        env.circleApiKey() && env.circleEntitySecret()
          ? undefined
          : 'set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET for DCW + App Kit',
    },
    {
      name: 'modular_wallets_client',
      ok: Boolean(env.modularClientKey()),
      detail: env.modularClientKey()
        ? undefined
        : 'set NEXT_PUBLIC_CIRCLE_CLIENT_KEY for passkey MSCA',
    },
  ];
  return { name: 'onchain', ok: checks.every(c => c.ok), checks };
}

async function checkIntelligence(): Promise<Subsystem> {
  const checks: Check[] = [
    {
      name: 'supported_locales',
      ok: SUPPORTED_LOCALES.length > 0,
      detail: SUPPORTED_LOCALES.join(', '),
    },
    await dbColumnCheck({ name: 'agent_memory_table', table: 'agent_memories', column: 'id' }),
    await dbColumnCheck({ name: 'preference_logs_table', table: 'preference_logs', column: 'id' }),
  ];
  return { name: 'intelligence', ok: checks.every(c => c.ok), checks };
}

async function checkOps(): Promise<Subsystem> {
  const checks: Check[] = [
    {
      name: 'database_url',
      ok: Boolean(process.env.DATABASE_URL),
      detail: process.env.DATABASE_URL ? undefined : 'set DATABASE_URL (Neon)',
    },
    {
      name: 'duffel_webhook_secret',
      ok: Boolean(env.duffelWebhookSecret()),
      detail: env.duffelWebhookSecret()
        ? undefined
        : 'set DUFFEL_WEBHOOK_SECRET (HMAC signature for POST /api/webhooks/duffel)',
    },
    {
      name: 'posthog',
      ok: Boolean(process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY),
      detail:
        process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
          ? undefined
          : 'optional — set POSTHOG_KEY (+ NEXT_PUBLIC_POSTHOG_KEY for client)',
    },
    {
      name: 'liveblocks',
      ok: Boolean(process.env.LIVEBLOCKS_SECRET_KEY),
      detail: process.env.LIVEBLOCKS_SECRET_KEY
        ? undefined
        : 'optional — set LIVEBLOCKS_SECRET_KEY for group-trip collab',
    },
    {
      name: 'basehub',
      ok: Boolean(process.env.BASEHUB_TOKEN),
      detail: process.env.BASEHUB_TOKEN
        ? undefined
        : 'optional — set BASEHUB_TOKEN for marketing + help CMS',
    },
  ];
  // Ops subsystem is "ok" when the essentials (DB) are wired — analytics/
  // collaboration/cms are optional enhancements.
  const essentialOk = checks.find(c => c.name === 'database_url')?.ok ?? false;
  return { name: 'ops', ok: essentialOk, checks };
}

/** Read a single Prisma column to confirm the migration landed. */
async function dbColumnCheck(args: {
  name: string;
  table: string;
  column: string;
}): Promise<Check> {
  try {
    // Parameterized columnName via Prisma.sql would be nicer, but information_schema
    // accepts quoted identifiers fine for our known schema.
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      args.table,
      args.column
    );
    const ok = rows.length > 0;
    return {
      name: args.name,
      ok,
      detail: ok
        ? undefined
        : `column ${args.column} missing on ${args.table} — run prisma migrate deploy`,
    };
  } catch (err) {
    return {
      name: args.name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

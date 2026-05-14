import { createOpenAI } from '@ai-sdk/openai';
import { prisma } from '@sendero/database';
import {
  injectLobsterTrapMetadata,
  lobsterTrapVerdictHeader,
  securityAlertPayload,
  severityForVerdict,
  summarizeLobsterTrapReport,
  type LobsterTrapContext,
  type LobsterTrapInspectionReport,
} from '@sendero/lobster-trap';
import type { Prisma } from '@prisma/client';
import type { LanguageModel } from 'ai';

export {
  injectLobsterTrapMetadata,
  lobsterTrapVerdictHeader,
  summarizeLobsterTrapReport,
  type LobsterTrapContext,
  type LobsterTrapInspectionReport,
} from '@sendero/lobster-trap';

export function lobsterTrapConfigured(): boolean {
  return Boolean(process.env.LOBSTERTRAP_BASE_URL);
}

export function createLobsterTrapModel(args: {
  modelId: string;
  context: LobsterTrapContext;
}): LanguageModel {
  const baseURL = lobsterTrapBaseUrl();
  const modelId = process.env.LOBSTERTRAP_MODEL || args.modelId;
  const provider = createOpenAI({
    name: 'lobstertrap',
    baseURL: `${baseURL}/v1`,
    apiKey: process.env.LOBSTERTRAP_API_KEY || process.env.OPENAI_API_KEY || 'sendero-local',
    headers: {
      'x-sendero-tenant-id': args.context.tenantId,
      'x-sendero-channel': args.context.channel,
      'x-sendero-turn-id': args.context.turnId,
      'x-sendero-x402': args.context.x402 ? 'true' : 'false',
    },
    fetch: lobsterTrapFetch(args.context),
  });

  return provider.chat(modelId as never);
}

export async function persistLobsterTrapAlerts(args: {
  tenantId: string;
  reports: LobsterTrapInspectionReport[];
  context: Omit<LobsterTrapContext, 'onReport'>;
}) {
  const actionable = args.reports.filter(report => report.verdict !== 'ALLOW');
  if (actionable.length === 0) return;

  for (const report of actionable) {
    await prisma.securityAlert
      .create({
        data: {
          tenantId: args.tenantId,
          kind: 'lobstertrap_policy_violation',
          severity: severityForVerdict(report.verdict),
          onchainTripId: null,
          payload: securityAlertPayload({
            report,
            context: args.context,
          }) as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(error => {
        console.error('[lobstertrap] failed to persist security alert', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function lobsterTrapFetch(context: LobsterTrapContext): typeof fetch {
  return async (input, init) => {
    const patchedInit = await patchRequestInit(init, context);
    const response = await fetch(input, patchedInit);
    const report = await readInspectionReport(response);
    if (report) context.onReport?.(report);
    return response;
  };
}

async function patchRequestInit(
  init: RequestInit | undefined,
  context: LobsterTrapContext
): Promise<RequestInit | undefined> {
  if (!init?.body || typeof init.body !== 'string') return init;
  const parsed = JSON.parse(init.body) as unknown;
  const injected = injectLobsterTrapMetadata(parsed, context);
  return { ...init, body: JSON.stringify(injected) };
}

async function readInspectionReport(
  response: Response
): Promise<LobsterTrapInspectionReport | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const cloned = response.clone();
  const body = await cloned.json().catch(() => null);
  return summarizeLobsterTrapReport(body);
}

function lobsterTrapBaseUrl(): string {
  const raw = process.env.LOBSTERTRAP_BASE_URL;
  if (!raw) throw new Error('LOBSTERTRAP_BASE_URL is required when Lobster Trap is enabled.');
  return raw.replace(/\/+$/, '');
}

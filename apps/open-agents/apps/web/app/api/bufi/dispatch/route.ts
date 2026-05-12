// BUFI bridge ingress — server-to-server entry point for the desk-v1
// minion pipeline. Bypasses the standard better-auth OAuth flow; gated
// by a shared Bearer secret (OPEN_AGENTS_BUFI_INGRESS_SECRET).
//
// All sessions created here are owned by a stable bot user
// (id: "bufi-bridge-bot") so they're visible + auditable in the OA
// web UI alongside human-driven sessions.
//
// See: docs/superpowers/specs/2026-05-11-phase-1-minion-bridge.md
// (in the parent desk-v1 monorepo).

import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { runAgentWorkflow } from '@/app/workflows/chat';
import { db } from '@/lib/db/client';
import { githubInstallations, users } from '@/lib/db/schema';
import { createSessionWithInitialChat } from '@/lib/db/sessions';
import { getAppOctokit } from '@/lib/github/app';
import { APP_DEFAULT_MODEL_ID } from '@/lib/models';

const BUFI_BOT_USER_ID = 'bufi-bridge-bot';
const BUFI_BOT_USERNAME = 'bufi-bridge-bot';
const BUFI_BOT_EMAIL = 'bridge@bu.finance';

interface DispatchRequestBody {
  blueprint: {
    taskId: string;
    title: string;
    riskTier: 'low' | 'medium' | 'high';
  };
  repo: {
    owner: string;
    name: string;
    branch: string;
  };
  prompt: string;
}

function verifyBufiIngress(req: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function getOrCreateBufiBotUser(): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, BUFI_BOT_USER_ID))
    .limit(1);
  if (existing[0]) return existing[0].id;

  await db.insert(users).values({
    id: BUFI_BOT_USER_ID,
    username: BUFI_BOT_USERNAME,
    email: BUFI_BOT_EMAIL,
    emailVerified: true,
    name: 'BUFI Bridge Bot',
    isAdmin: false,
  });
  return BUFI_BOT_USER_ID;
}

/**
 * Ensure a github_installations row exists for the bot user pointing at
 * the BUFI GitHub App's installation on `accountLogin` (e.g. BuFi007).
 *
 * This lets the standard OA flow — verifyRepoAccess → mintInstallationToken
 * → connectSandbox({ githubToken }) — work for bot-dispatched sessions
 * even though the bot user has no OAuth token. The user-octokit precondition
 * is bypassed in lib/github/access.ts for this specific user id.
 */
async function ensureBufiInstallation(accountLogin: string): Promise<void> {
  const existing = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, BUFI_BOT_USER_ID),
        eq(githubInstallations.accountLogin, accountLogin)
      )
    )
    .limit(1);
  if (existing[0]) return;

  const appOctokit = getAppOctokit();
  let install: {
    id: number;
    accountType: 'User' | 'Organization';
    repositorySelection: 'all' | 'selected';
    htmlUrl: string | null;
  } | null = null;

  // Orgs first (BuFi007 is an org). Fall back to user account if needed.
  try {
    const resp = await appOctokit.rest.apps.getOrgInstallation({ org: accountLogin });
    install = {
      id: resp.data.id,
      accountType: 'Organization',
      repositorySelection: resp.data.repository_selection as 'all' | 'selected',
      htmlUrl: resp.data.html_url ?? null,
    };
  } catch {
    try {
      const resp = await appOctokit.rest.apps.getUserInstallation({ username: accountLogin });
      install = {
        id: resp.data.id,
        accountType: 'User',
        repositorySelection: resp.data.repository_selection as 'all' | 'selected',
        htmlUrl: resp.data.html_url ?? null,
      };
    } catch {
      install = null;
    }
  }

  if (!install) {
    throw new Error(
      `GitHub App not installed on '${accountLogin}'. Install the BUFI Open Agents Bot app on this account and grant repo access.`
    );
  }

  await db.insert(githubInstallations).values({
    id: nanoid(),
    userId: BUFI_BOT_USER_ID,
    installationId: install.id,
    accountLogin,
    accountType: install.accountType,
    repositorySelection: install.repositorySelection,
    installationUrl: install.htmlUrl,
  });
}

function isValidBody(value: unknown): value is DispatchRequestBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.prompt !== 'string' || v.prompt.length === 0) return false;

  const bp = v.blueprint as Record<string, unknown> | undefined;
  if (!bp || typeof bp.taskId !== 'string' || typeof bp.title !== 'string') {
    return false;
  }

  const repo = v.repo as Record<string, unknown> | undefined;
  if (!repo || typeof repo.owner !== 'string' || typeof repo.name !== 'string') {
    return false;
  }

  return true;
}

export async function POST(req: NextRequest) {
  if (!verifyBufiIngress(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: 'Missing required fields: blueprint, repo, prompt' },
      { status: 400 }
    );
  }

  let botUserId: string;
  try {
    botUserId = await getOrCreateBufiBotUser();
  } catch (error) {
    console.error('[bufi-dispatch] bot user seed failed:', error);
    return NextResponse.json({ error: 'Bot user provisioning failed' }, { status: 500 });
  }

  // Ensure the bot has a github_installations row for the target owner so
  // OA's standard verifyRepoAccess → mintInstallationToken flow works.
  try {
    await ensureBufiInstallation(body.repo.owner);
  } catch (error) {
    console.error('[bufi-dispatch] github installation seed failed:', error);
    return NextResponse.json(
      { error: 'github_app_not_installed', message: (error as Error).message },
      { status: 502 }
    );
  }

  // Construct the cloneUrl so chat-sandbox-runtime.ts triggers its
  // setupToken minting path (which uses the bot's installation we just
  // ensured above).
  const cloneUrl = `https://github.com/${body.repo.owner}/${body.repo.name}.git`;

  const sessionId = nanoid();
  const chatId = nanoid();
  const messageId = nanoid();

  let session: { id: string };
  let chat: { id: string };
  try {
    const result = await createSessionWithInitialChat({
      session: {
        id: sessionId,
        userId: botUserId,
        title: `BUFI: ${body.blueprint.title}`,
        repoOwner: body.repo.owner,
        repoName: body.repo.name,
        branch: body.repo.branch,
        cloneUrl,
        autoCommitPushOverride: true,
        autoCreatePrOverride: true,
      },
      initialChat: {
        id: chatId,
        title: body.blueprint.title,
        modelId: APP_DEFAULT_MODEL_ID,
      },
    });
    session = result.session;
    chat = result.chat;
  } catch (error) {
    console.error('[bufi-dispatch] createSessionWithInitialChat failed:', error);
    return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
  }

  let workflowRunId: string;
  try {
    const run = await start(runAgentWorkflow, [
      {
        messages: [
          {
            id: messageId,
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: body.prompt }],
          },
        ],
        chatId: chat.id,
        sessionId: session.id,
        userId: botUserId,
        requestUrl: req.url,
        authSession: null,
        autoCommitEnabled: true,
        autoCreatePrEnabled: true,
      } as Parameters<typeof runAgentWorkflow>[0],
    ]);
    workflowRunId = run.runId;
  } catch (error) {
    console.error('[bufi-dispatch] runAgentWorkflow start failed:', error);
    return NextResponse.json(
      { error: 'Workflow start failed', sessionId: session.id, chatId: chat.id },
      { status: 500 }
    );
  }

  console.log('[bufi-dispatch] dispatched', {
    taskId: body.blueprint.taskId,
    repo: `${body.repo.owner}/${body.repo.name}`,
    sessionId: session.id,
    workflowRunId,
  });

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    sessionId: session.id,
    chatId: chat.id,
    workflowRunId,
    streamUrl: `${origin}/sessions/${session.id}`,
  });
}

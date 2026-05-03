/**
 * Bridge between @sendero/workflows runner and the Session.threadContext
 * persistence the rest of the platform uses for paused runs.
 *
 * Channel setup wizards (WhatsApp, Slack) need to:
 *   1. Find or start a paused workflow for (tenant, wizard surface)
 *   2. Project the runner output into a wizard-friendly snapshot
 *   3. Resume against the operator's form values, repersist
 *
 * Persistence model (matches /api/workflows/{run,resume}):
 *   - Each pause writes a `Session` row with `threadContext = { runId,
 *     workflowId, pausedStepId, pauseReason, pausePayload, scratchpad }`.
 *   - `subjectKey = "channels:whatsapp"` (or `"channels:slack"`) lets us
 *     dedupe to a single open wizard run per tenant+surface — the
 *     `(tenantId, subjectKey)` unique index on Session enforces it.
 *   - On terminal (completed | failed), we delete the row so the next
 *     visit starts a fresh run.
 *
 * Why we own this in apps/ rather than calling /api/workflows/run from a
 * Server Component: the route uses the chat tool registry shape and adds
 * its own analytics/meter hooks. The wizard wants the same canonical
 * registry but no fan-out — a thin adapter is cleaner than abusing the
 * HTTP route from inside the same process.
 */

import { type Prisma, prisma } from '@sendero/database';
import { type ToolContext, toolList } from '@sendero/tools';
import {
  findWorkflow,
  resumeRun,
  startRun,
  type ToolRegistry,
  type WorkflowDef,
  type WorkflowRun,
  type WorkflowStep,
} from '@sendero/workflows';

import type { WizardRunSnapshot, WizardStepDef } from '@/components/channels/setup-wizard/types';

// ─── tool registry ────────────────────────────────────────────────────

/**
 * Registry from the canonical toolList, scoped to the active operator.
 * Mirrors the wiring in /api/chat so per-tenant tools (Kapso/Slack
 * provisioning) see the same context whether they fire from the wizard
 * or from a chat-side run_workflow.
 */
export function buildWizardToolRegistry(ctx: ToolContext = {}): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const def of toolList) {
    registry[def.name] = args => def.handler(args, ctx);
  }
  return registry;
}

// ─── persisted thread context shape ───────────────────────────────────

interface PersistedThreadContext {
  runId: string;
  workflowId: string;
  pausedStepId: string;
  pauseReason: WorkflowRun['pauseReason'];
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
  /** Mirrored on every persist so we can rebuild the trail on resume. */
  trail?: WorkflowRun['trail'];
  /** When the run started — preserves elapsed time across resumes. */
  startedAt?: string;
}

function isPersistedThreadContext(raw: unknown): raw is PersistedThreadContext {
  if (!raw || typeof raw !== 'object') return false;
  const ctx = raw as Partial<PersistedThreadContext>;
  return (
    typeof ctx.runId === 'string' &&
    typeof ctx.workflowId === 'string' &&
    typeof ctx.pausedStepId === 'string' &&
    typeof ctx.pauseReason === 'string' &&
    typeof ctx.scratchpad === 'object' &&
    ctx.scratchpad !== null
  );
}

function threadContextFromRun(run: WorkflowRun): PersistedThreadContext {
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    pausedStepId: run.nextStepId ?? '',
    pauseReason: run.pauseReason,
    pausePayload: run.pausePayload,
    scratchpad: run.scratchpad,
    trail: run.trail,
    startedAt: run.startedAt.toISOString(),
  };
}

// ─── load-or-start ────────────────────────────────────────────────────

interface LoadOrStartArgs {
  tenantId: string;
  workflowId: string;
  /** "channels:whatsapp" / "channels:slack" — Session.subjectKey scope. */
  surfaceKey: string;
  /** Operator running the wizard. Stored on Session.userId. */
  startedByUserId?: string;
  /** Initial scratchpad input. */
  input?: Record<string, unknown>;
  ctx?: ToolContext;
}

/**
 * Resolve the active wizard session: reuse an open paused Session if one
 * exists, otherwise start the workflow forward to the first pause and
 * persist a new Session row.
 */
export async function loadOrStartWizardSession(args: LoadOrStartArgs): Promise<WizardRunSnapshot> {
  const def = findWorkflow(args.workflowId);
  if (!def) throw new Error(`unknown_workflow:${args.workflowId}`);

  const existing = await prisma.session.findUnique({
    where: { tenantId_subjectKey: { tenantId: args.tenantId, subjectKey: args.surfaceKey } },
  });

  if (existing && isPersistedThreadContext(existing.threadContext)) {
    const pauseStepIds = new Set(collectPauseSteps(def).map(step => step.id));
    if (pauseStepIds.has(existing.threadContext.pausedStepId)) {
      const stale = await shouldDiscardWizardSession({
        tenantId: args.tenantId,
        surfaceKey: args.surfaceKey,
        ctx: existing.threadContext,
      });
      if (stale) {
        await prisma.session.delete({ where: { id: existing.id } }).catch(() => {});
      } else {
        return projectFromSession(existing.id, def, existing.threadContext);
      }
    } else {
      await prisma.session.delete({ where: { id: existing.id } }).catch(() => {});
    }
  }

  // No active session — start fresh and persist whatever the run hits
  // (a pause or a terminal).
  const tools = buildWizardToolRegistry(args.ctx);
  const run = await startRun({
    workflow: def,
    input: args.input ?? { tenantId: args.tenantId },
    tools,
  });
  const sessionId = await persistRunForSurface({
    tenantId: args.tenantId,
    surfaceKey: args.surfaceKey,
    userId: args.startedByUserId ?? null,
    existingSessionId: existing?.id ?? null,
    run,
  });
  if (run.status === 'paused' && sessionId) {
    return projectFromSession(sessionId, def, threadContextFromRun(run));
  }
  // Terminal on first run (no pauses) — render an empty snapshot whose
  // `status` reflects the outcome so the wizard shell renders the
  // completion / failure panel.
  return {
    sessionId: sessionId ?? '',
    workflowId: def.id,
    workflowLabel: def.label,
    status: run.status,
    scratchpad: run.scratchpad,
    steps: collectWizardSteps(def, run),
    error: run.error,
  };
}

async function shouldDiscardWizardSession(args: {
  tenantId: string;
  surfaceKey: string;
  ctx: PersistedThreadContext;
}): Promise<boolean> {
  if (args.surfaceKey !== 'channels:whatsapp') return false;
  if (args.ctx.pausedStepId === 'verify_number') return false;

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: args.tenantId },
    select: { phoneNumberId: true, displayPhoneNumber: true, status: true },
  });
  if (!install) return true;
  if (install.status === 'disabled' || install.status === 'error') return true;
  if (!install.phoneNumberId || install.phoneNumberId === 'pending') return true;
  if (!install.displayPhoneNumber || /pending/i.test(install.displayPhoneNumber)) return true;
  return false;
}

// ─── resume ───────────────────────────────────────────────────────────

interface ResumeArgs {
  tenantId: string;
  sessionId: string;
  resolution: Record<string, unknown>;
  ctx?: ToolContext;
}

/**
 * Resume the paused run pointed at by `sessionId`. The runner advances
 * past the pause; if it hits another pause, we update the same Session
 * row (so the wizard rail stays continuous). On terminal we delete the
 * row.
 */
export async function resumeWizardSession(args: ResumeArgs): Promise<WizardRunSnapshot> {
  const session = await prisma.session.findUnique({ where: { id: args.sessionId } });
  if (!session) throw new Error('wizard_session_not_found');
  if (session.tenantId !== args.tenantId) throw new Error('wizard_session_tenant_mismatch');
  if (!isPersistedThreadContext(session.threadContext)) {
    throw new Error('wizard_session_invalid_context');
  }
  const ctx: PersistedThreadContext = session.threadContext;

  const def = findWorkflow(ctx.workflowId);
  if (!def) throw new Error(`unknown_workflow:${ctx.workflowId}`);

  const tools = buildWizardToolRegistry(args.ctx);
  const previous: WorkflowRun = {
    workflowId: session.threadContext.workflowId,
    runId: session.threadContext.runId,
    status: 'paused',
    startedAt: session.threadContext.startedAt
      ? new Date(session.threadContext.startedAt)
      : new Date(),
    pausedAt: new Date(),
    pauseReason: session.threadContext.pauseReason,
    pausePayload: session.threadContext.pausePayload,
    scratchpad: session.threadContext.scratchpad,
    trail: session.threadContext.trail ?? [],
    nextStepId: session.threadContext.pausedStepId,
  };

  const next = await resumeRun({
    workflow: def,
    run: previous,
    resolution: args.resolution,
    tools,
  });

  if (next.status === 'paused') {
    await prisma.session.update({
      where: { id: session.id },
      data: {
        threadContext: threadContextFromRun(next) as unknown as Prisma.InputJsonValue,
      },
    });
    return projectFromSession(session.id, def, threadContextFromRun(next));
  }

  // Terminal: delete the row so the next /connect visit starts fresh.
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  return {
    sessionId: session.id,
    workflowId: def.id,
    workflowLabel: def.label,
    status: next.status,
    scratchpad: next.scratchpad,
    steps: collectWizardSteps(def, next),
    error: next.error,
  };
}

interface JumpArgs {
  tenantId: string;
  sessionId: string;
  stepId: string;
}

/**
 * Move an open wizard session back to a completed pause step.
 *
 * This is intentionally a rewind, not arbitrary navigation: future
 * steps remain locked, and any scratchpad/trail entries from the target
 * step onward are dropped so the next Continue replays downstream tools
 * with the corrected inputs.
 */
export async function jumpWizardSession(args: JumpArgs): Promise<WizardRunSnapshot> {
  const session = await prisma.session.findUnique({ where: { id: args.sessionId } });
  if (!session) throw new Error('wizard_session_not_found');
  if (session.tenantId !== args.tenantId) throw new Error('wizard_session_tenant_mismatch');
  if (!isPersistedThreadContext(session.threadContext)) {
    throw new Error('wizard_session_invalid_context');
  }
  const ctx: PersistedThreadContext = session.threadContext;

  const def = findWorkflow(ctx.workflowId);
  if (!def) throw new Error(`unknown_workflow:${ctx.workflowId}`);

  const pauseSteps = collectPauseSteps(def);
  const target = pauseSteps.find(step => step.id === args.stepId);
  if (!target) throw new Error('wizard_step_not_found');

  const currentStepId = ctx.pausedStepId;
  if (currentStepId === args.stepId) {
    return projectFromSession(session.id, def, ctx);
  }

  const orderedStepIds = collectStepIds(def.steps);
  const targetIndex = orderedStepIds.indexOf(args.stepId);
  const currentIndex = orderedStepIds.indexOf(currentStepId);
  if (targetIndex < 0 || currentIndex < 0) throw new Error('wizard_step_order_invalid');
  if (targetIndex > currentIndex) throw new Error('wizard_step_not_reachable');

  const pruneFrom = new Set(orderedStepIds.slice(targetIndex));
  const scratchpad = { ...ctx.scratchpad };
  for (const key of pruneFrom) delete scratchpad[key];
  for (const step of collectSteps(def.steps)) {
    if (pruneFrom.has(step.id) && step.kind === 'tool' && step.as) {
      delete scratchpad[step.as];
    }
  }

  const nextContext: PersistedThreadContext = {
    ...ctx,
    pausedStepId: args.stepId,
    pauseReason: 'user_reply',
    pausePayload: target.payload,
    scratchpad,
    trail: (ctx.trail ?? []).filter(entry => !pruneFrom.has(entry.stepId)),
  };

  await prisma.session.update({
    where: { id: session.id },
    data: { threadContext: nextContext as unknown as Prisma.InputJsonValue },
  });

  return projectFromSession(session.id, def, nextContext);
}

// ─── persistence helpers ──────────────────────────────────────────────

interface PersistArgs {
  tenantId: string;
  surfaceKey: string;
  userId: string | null;
  existingSessionId: string | null;
  run: WorkflowRun;
}

async function persistRunForSurface(args: PersistArgs): Promise<string | null> {
  if (args.run.status === 'paused') {
    // Resolve the local User cuid from Clerk userId so the FK on
    // Session.userId stays valid. Session.userId is nullable, so a
    // missing match silently drops the audit attribution rather than
    // failing the wizard.
    const localUserId = args.userId
      ? ((
          await prisma.user.findUnique({
            where: { clerkUserId: args.userId },
            select: { id: true },
          })
        )?.id ?? null)
      : null;
    const data = {
      tenantId: args.tenantId,
      userId: localUserId,
      subjectKey: args.surfaceKey,
      threadContext: threadContextFromRun(args.run) as unknown as Prisma.InputJsonValue,
      expiresAt: null,
    };
    const row = await prisma.session.upsert({
      where: { tenantId_subjectKey: { tenantId: args.tenantId, subjectKey: args.surfaceKey } },
      update: { threadContext: data.threadContext, userId: localUserId },
      create: data,
    });
    return row.id;
  }
  // Terminal on first run — no pause persistence needed; clean any
  // pre-existing row from a prior aborted attempt.
  if (args.existingSessionId) {
    await prisma.session.delete({ where: { id: args.existingSessionId } }).catch(() => {});
  }
  return null;
}

// ─── projection ───────────────────────────────────────────────────────

function projectFromSession(
  sessionId: string,
  def: WorkflowDef,
  ctx: PersistedThreadContext
): WizardRunSnapshot {
  const pauseSteps = collectPauseSteps(def);
  const steps = collectWizardSteps(def, {
    nextStepId: ctx.pausedStepId,
    trail: ctx.trail,
  });
  const activeStep = steps.find(s => s.id === ctx.pausedStepId);
  const activeDefinition = pauseSteps.find(s => s.id === ctx.pausedStepId);
  return {
    sessionId,
    workflowId: ctx.workflowId,
    workflowLabel: def.label,
    status: 'paused',
    scratchpad: ctx.scratchpad,
    steps,
    activeStep,
    activePayload: {
      ...(ctx.pausePayload ?? {}),
      ...(activeDefinition?.payload ?? {}),
    },
  };
}

interface MinimalRunForRail {
  nextStepId?: string;
  trail?: Array<{ stepId: string; ok: boolean }>;
}

function collectWizardSteps(def: WorkflowDef, run: MinimalRunForRail): WizardStepDef[] {
  const pauseSteps = collectPauseSteps(def);
  const completed = new Set((run.trail ?? []).filter(t => t.ok).map(t => t.stepId));
  return pauseSteps.map((s, i) => ({
    id: s.id,
    label: s.label,
    promptId: typeof s.payload?.promptId === 'string' ? s.payload.promptId : undefined,
    status: completed.has(s.id) ? 'completed' : run.nextStepId === s.id ? 'active' : 'pending',
    index: i + 1,
  }));
}

interface PauseStepWithPayload {
  id: string;
  label: string;
  payload?: Record<string, unknown>;
}

/** Walk the workflow tree and surface every pause step in canonical order. */
function collectPauseSteps(def: WorkflowDef): PauseStepWithPayload[] {
  const out: PauseStepWithPayload[] = [];
  const walk = (steps: WorkflowDef['steps']) => {
    for (const step of steps) {
      if (step.kind === 'pause') {
        out.push({ id: step.id, label: step.label, payload: step.payload });
      } else if (step.kind === 'branch') {
        walk(step.then);
        if (step.otherwise) walk(step.otherwise);
      } else if (step.kind === 'parallel') {
        for (const branch of step.branches) walk(branch.steps);
      }
    }
  };
  walk(def.steps);
  return out;
}

function collectSteps(steps: WorkflowDef['steps']): WorkflowStep[] {
  const out: WorkflowStep[] = [];
  const walk = (items: WorkflowDef['steps']) => {
    for (const step of items) {
      out.push(step);
      if (step.kind === 'branch') {
        walk(step.then);
        if (step.otherwise) walk(step.otherwise);
      } else if (step.kind === 'parallel') {
        for (const branch of step.branches) walk(branch.steps);
      }
    }
  };
  walk(steps);
  return out;
}

function collectStepIds(steps: WorkflowDef['steps']): string[] {
  return collectSteps(steps).map(step => step.id);
}

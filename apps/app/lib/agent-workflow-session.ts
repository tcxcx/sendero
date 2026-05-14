/**
 * Conversational workflow sessions — durable multi-step state for the
 * agent-driven channel turns (WhatsApp / Slack / web).
 *
 * Mirrors `apps/app/lib/wizard-session.ts` but for the traveler side.
 * The wizard runs operator-side and is keyed `(tenantId, "channels:X")`.
 * Agent workflows run traveler-side and are keyed
 * `(tenantId, "agent:<channel>:<channelIdentityId>")` so each traveler
 * thread can pause its own multi-step flow without colliding with
 * other travelers on the same channel.
 *
 * Lifecycle:
 *   1. Agent calls `start_workflow({ id, input })` mid-turn.
 *   2. Runner executes synchronously up to the first pause OR to
 *      completion. On pause we persist a `Session` row with the
 *      paused step + scratchpad; the agent's reply relays the pause
 *      prompt to the traveler.
 *   3. Next inbound: webhook checks `loadPausedAgentWorkflow` first.
 *      If a paused workflow exists, the user's text is treated as
 *      the resolution payload and `resumeAgentWorkflow` continues
 *      execution. Otherwise the inbound falls through to a fresh
 *      `runAgentTurn`.
 *   4. Step trail accumulates on `Session.threadContext.trail` so the
 *      workflow's progress is auditable and re-renderable.
 *
 * The `Session` row's lifecycle:
 *   - paused workflow → row exists, threadContext set
 *   - completed → row deleted (clean slate for next workflow)
 *   - resumed but pauses again → threadContext rewritten in place
 */

import { type Prisma, prisma } from '@sendero/database';
import {
  findWorkflow,
  resumeRun,
  startRun,
  type StepTrailEntry,
  type ToolRegistry,
  type WorkflowDef,
  type WorkflowRun,
} from '@sendero/workflows';
import { toolList } from '@sendero/tools';
import type { ToolContext } from '@sendero/tools/types';

/**
 * Append a workflow step transition to the trip's append-only event
 * ledger. Mirrors Kapso's `execution events` log: every step the
 * runner finishes (or fails) is visible in MetaInbox + trip inbox in
 * real time, so operators see multi-step flows progress alongside
 * the conversation. Best-effort — a ledger write failure must never
 * derail the workflow run.
 */
async function appendWorkflowStepEvent(args: {
  tenantId: string;
  tripId: string;
  workflowId: string;
  runId: string;
  entry: StepTrailEntry;
}): Promise<void> {
  try {
    const event: Prisma.InputJsonObject = {
      id: `wf_${args.runId}_${args.entry.stepId}`,
      kind: 'workflow_step_finished',
      direction: 'internal',
      channel: 'internal',
      workflowId: args.workflowId,
      runId: args.runId,
      stepId: args.entry.stepId,
      stepKind: args.entry.kind,
      label: args.entry.label,
      ok: args.entry.ok,
      startedAt: args.entry.startedAt.toISOString(),
      finishedAt: args.entry.finishedAt.toISOString(),
      createdAt: new Date().toISOString(),
      ...(args.entry.priceMicroUsdc !== undefined
        ? { priceMicroUsdc: args.entry.priceMicroUsdc.toString() }
        : {}),
    };
    await prisma.$executeRaw`
      UPDATE trips
         SET events = COALESCE(events, '[]'::jsonb) || ${event as unknown as Prisma.JsonValue}::jsonb
       WHERE id = ${args.tripId} AND "tenantId" = ${args.tenantId}
    `;
  } catch (err) {
    console.warn('[agent-workflow-session] append step event failed (non-fatal)', {
      tripId: args.tripId,
      stepId: args.entry.stepId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Build the step hook closure when the run is anchored to a trip. */
function stepHooksForTrip(args: {
  tenantId: string;
  tripId: string | null;
  workflowId: string;
  runId: string;
}): { onStep?: (entry: StepTrailEntry) => Promise<void> } {
  if (!args.tripId) return {};
  return {
    onStep: entry =>
      appendWorkflowStepEvent({
        tenantId: args.tenantId,
        tripId: args.tripId!,
        workflowId: args.workflowId,
        runId: args.runId,
        entry,
      }),
  };
}

// ─── persisted thread-context shape ──────────────────────────────────

/** What we stash on `Session.threadContext` for a paused workflow run.
 *  Compatible with `wizard-session.ts::PersistedThreadContext` so the
 *  Slack approval interactions handler keeps working — they share the
 *  same Session table. */
export interface PersistedAgentWorkflowContext {
  runId: string;
  workflowId: string;
  pausedStepId: string;
  pauseReason: WorkflowRun['pauseReason'];
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
  trail?: WorkflowRun['trail'];
  startedAt?: string;
  /** Traveler-side marker so we can distinguish from operator wizard
   *  Sessions on the same table. */
  source: 'agent';
  /** Channel + identity that owns this run — used by the webhook
   *  resume path to find the right Session row. */
  channelIdentityId: string;
  channel: AgentWorkflowChannel;
}

function isPersistedAgentContext(raw: unknown): raw is PersistedAgentWorkflowContext {
  if (!raw || typeof raw !== 'object') return false;
  const ctx = raw as Partial<PersistedAgentWorkflowContext>;
  return (
    ctx.source === 'agent' &&
    typeof ctx.runId === 'string' &&
    typeof ctx.workflowId === 'string' &&
    typeof ctx.pausedStepId === 'string' &&
    typeof ctx.scratchpad === 'object' &&
    ctx.scratchpad !== null &&
    typeof ctx.channelIdentityId === 'string'
  );
}

function contextFromRun(
  run: WorkflowRun,
  channel: PersistedAgentWorkflowContext['channel'],
  channelIdentityId: string
): PersistedAgentWorkflowContext {
  return {
    source: 'agent',
    runId: run.runId,
    workflowId: run.workflowId,
    pausedStepId: run.nextStepId ?? '',
    pauseReason: run.pauseReason,
    pausePayload: run.pausePayload,
    scratchpad: run.scratchpad,
    trail: run.trail,
    startedAt: run.startedAt.toISOString(),
    channel,
    channelIdentityId,
  };
}

// ─── subject-key conventions ─────────────────────────────────────────

/**
 * Channel adapters that own an agent-workflow Session. `api` is the
 * marker for external-API-key callers (no channelIdentity, keyed by
 * the API key id or, on first start, the workflow runId).
 */
export type AgentWorkflowChannel = 'whatsapp' | 'slack' | 'web' | 'api';

export function agentWorkflowSubjectKey(args: {
  channel: AgentWorkflowChannel;
  channelIdentityId: string;
}): string {
  return `agent:${args.channel}:${args.channelIdentityId}`;
}

// ─── tool registry ────────────────────────────────────────────────────

/** Build the workflow runner's tool map from Sendero's canonical
 *  tool catalog. The runner's `ToolRegistry` is `{ name → async fn }`;
 *  we wrap each `ToolDef.handler` with the caller-supplied `ToolContext`
 *  so workflow tool calls inherit the same caller identity that the
 *  agent turn was running under. */
export function buildAgentWorkflowToolRegistry(ctx: ToolContext = {}): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const def of toolList) {
    registry[def.name] = (args: Record<string, unknown>) => def.handler(args, ctx);
  }
  return registry;
}

// ─── start ────────────────────────────────────────────────────────────

export interface StartAgentWorkflowArgs {
  tenantId: string;
  /** Channel adapter that owns this run — drives Session subjectKey. */
  channel: AgentWorkflowChannel;
  /** ChannelIdentity row id — keys the Session per-traveler. */
  channelIdentityId: string;
  /** Optional Sendero User id stamped on the Session row. */
  userId?: string | null;
  /** Optional active trip — when set, every workflow step transition
   *  is appended to `Trip.events` so MetaInbox + trip inbox surface
   *  the run's progress in real time. */
  tripId?: string | null;
  workflowId: string;
  input?: Record<string, unknown>;
  toolCtx?: ToolContext;
}

export interface AgentWorkflowSnapshot {
  status: 'paused' | 'completed' | 'failed';
  workflowId: string;
  workflowLabel?: string;
  runId: string;
  /** Pause prompt for the agent to relay to the traveler. Empty string
   *  on completion. */
  pausePrompt: string;
  /** Reason the run paused, when paused. */
  pauseReason?: WorkflowRun['pauseReason'];
  /** Final scratchpad — useful for the agent to summarize completion. */
  scratchpad: Record<string, unknown>;
  /** Persisted Session.id when paused. */
  sessionId?: string;
}

/**
 * Start a workflow for the active channel turn. Runs synchronously to
 * the first pause OR to completion. On pause, persists a Session row
 * keyed by `(tenantId, agent:<channel>:<channelIdentityId>)` so the
 * next inbound can resume.
 */
export async function startAgentWorkflow(
  args: StartAgentWorkflowArgs
): Promise<AgentWorkflowSnapshot> {
  const def = findWorkflow(args.workflowId);
  if (!def) throw new Error(`unknown_workflow:${args.workflowId}`);

  const subjectKey = agentWorkflowSubjectKey({
    channel: args.channel,
    channelIdentityId: args.channelIdentityId,
  });

  // Drop any prior paused run on this thread — a fresh `start_workflow`
  // intent supersedes whatever was in flight (usually a stale pause
  // the traveler abandoned). Wizard sessions on this same Session table
  // use a different subjectKey shape so they're untouched. `deleteMany`
  // is a no-op when nothing matches (no Prisma error log).
  await prisma.session.deleteMany({
    where: { tenantId: args.tenantId, subjectKey },
  });

  const tools = buildAgentWorkflowToolRegistry(args.toolCtx);
  const runId = crypto.randomUUID();
  const hooks = stepHooksForTrip({
    tenantId: args.tenantId,
    tripId: args.tripId ?? null,
    workflowId: args.workflowId,
    runId,
  });
  const run = await startRun({
    workflow: def,
    input: args.input ?? {},
    tools,
    runId,
    hooks,
  });

  return projectAndPersist({
    run,
    def,
    tenantId: args.tenantId,
    subjectKey,
    channel: args.channel,
    channelIdentityId: args.channelIdentityId,
    userId: args.userId ?? null,
  });
}

// ─── load + resume ───────────────────────────────────────────────────

export interface LoadPausedArgs {
  tenantId: string;
  channel: AgentWorkflowChannel;
  channelIdentityId: string;
}

export interface PausedAgentWorkflow {
  sessionId: string;
  def: WorkflowDef;
  ctx: PersistedAgentWorkflowContext;
}

/**
 * Look up the active paused workflow for this channel identity, if
 * any. Returns null when no Session row exists OR when the row's
 * threadContext doesn't match the agent shape (likely a wizard /
 * approval session — leave it alone).
 */
export async function loadPausedAgentWorkflow(
  args: LoadPausedArgs
): Promise<PausedAgentWorkflow | null> {
  const subjectKey = agentWorkflowSubjectKey({
    channel: args.channel,
    channelIdentityId: args.channelIdentityId,
  });
  const session = await prisma.session.findUnique({
    where: { tenantId_subjectKey: { tenantId: args.tenantId, subjectKey } },
  });
  if (!session) return null;
  if (!isPersistedAgentContext(session.threadContext)) return null;
  const def = findWorkflow(session.threadContext.workflowId);
  if (!def) return null;
  return { sessionId: session.id, def, ctx: session.threadContext };
}

export interface ResumeAgentWorkflowArgs {
  tenantId: string;
  paused: PausedAgentWorkflow;
  /** What the user just said — folded into the workflow's resolution
   *  under the paused step's id. Workflow steps can read it via
   *  `$('<pausedStepId>.userInput')` from the scratchpad. */
  userInput: string;
  toolCtx?: ToolContext;
  /** Override channel/identity if they differ from the persisted ctx
   *  (rare — channel re-binding). */
  channelIdentityId?: string;
  channel?: AgentWorkflowChannel;
  userId?: string | null;
  /** Optional active trip for the step-event ledger fan-out. */
  tripId?: string | null;
}

/**
 * Resume a paused workflow with the traveler's most recent message as
 * the resolution payload. Re-persists if the workflow pauses again
 * (multi-step flow), or deletes the Session row on completion.
 */
export async function resumeAgentWorkflow(
  args: ResumeAgentWorkflowArgs
): Promise<AgentWorkflowSnapshot> {
  const { def, ctx, sessionId } = args.paused;
  const channel = args.channel ?? ctx.channel;
  const channelIdentityId = args.channelIdentityId ?? ctx.channelIdentityId;

  const tools = buildAgentWorkflowToolRegistry(args.toolCtx);
  const hooks = stepHooksForTrip({
    tenantId: args.tenantId,
    tripId: args.tripId ?? null,
    workflowId: ctx.workflowId,
    runId: ctx.runId,
  });
  const next = await resumeRun({
    workflow: def,
    run: {
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      status: 'paused',
      startedAt: ctx.startedAt ? new Date(ctx.startedAt) : new Date(),
      pausedAt: new Date(),
      pauseReason: ctx.pauseReason,
      pausePayload: ctx.pausePayload,
      scratchpad: ctx.scratchpad,
      trail: ctx.trail ?? [],
      nextStepId: ctx.pausedStepId,
    },
    resolution: { userInput: args.userInput, at: new Date().toISOString() },
    tools,
    hooks,
  });

  return projectAndPersist({
    run: next,
    def,
    tenantId: args.tenantId,
    subjectKey: agentWorkflowSubjectKey({ channel, channelIdentityId }),
    channel,
    channelIdentityId,
    userId: args.userId ?? null,
    existingSessionId: sessionId,
  });
}

// ─── persist + project ───────────────────────────────────────────────

interface PersistAndProjectArgs {
  run: WorkflowRun;
  def: WorkflowDef;
  tenantId: string;
  subjectKey: string;
  channel: AgentWorkflowChannel;
  channelIdentityId: string;
  userId: string | null;
  existingSessionId?: string;
}

async function projectAndPersist(args: PersistAndProjectArgs): Promise<AgentWorkflowSnapshot> {
  const { run, def } = args;
  const base: Pick<AgentWorkflowSnapshot, 'workflowId' | 'workflowLabel' | 'runId' | 'scratchpad'> =
    {
      workflowId: run.workflowId,
      workflowLabel: def.label,
      runId: run.runId,
      scratchpad: run.scratchpad,
    };

  if (run.status === 'paused') {
    const ctx = contextFromRun(run, args.channel, args.channelIdentityId);
    const row = await prisma.session.upsert({
      where: { tenantId_subjectKey: { tenantId: args.tenantId, subjectKey: args.subjectKey } },
      update: {
        threadContext: ctx as unknown as Prisma.InputJsonValue,
        userId: args.userId,
      },
      create: {
        tenantId: args.tenantId,
        userId: args.userId,
        subjectKey: args.subjectKey,
        threadContext: ctx as unknown as Prisma.InputJsonValue,
        expiresAt: null,
      },
    });
    return {
      ...base,
      status: 'paused',
      pauseReason: run.pauseReason,
      pausePrompt: pausePromptFromRun(run, def),
      sessionId: row.id,
    };
  }

  // Terminal — clean up any prior session row and let downstream
  // callers pick up from the scratchpad. `deleteMany` is no-op-safe
  // when nothing matches (avoids noisy P2025 logs).
  if (args.existingSessionId) {
    await prisma.session.deleteMany({ where: { id: args.existingSessionId } });
  } else {
    await prisma.session.deleteMany({
      where: { tenantId: args.tenantId, subjectKey: args.subjectKey },
    });
  }

  return {
    ...base,
    status: run.status,
    pausePrompt: '',
  };
}

/**
 * Extract the user-facing prompt for a paused step. Pause steps
 * declare a `prompt` payload that's intended for the traveler — fall
 * back to the step's `label` so callers always have something to
 * relay even if a workflow forgot to set the prompt.
 */
function pausePromptFromRun(run: WorkflowRun, def: WorkflowDef): string {
  if (run.status !== 'paused' || !run.nextStepId) return '';
  const step = findStepById(def, run.nextStepId);
  if (!step) return '';
  if (step.kind !== 'pause') return step.label ?? '';
  const payload = run.pausePayload as { prompt?: string } | undefined;
  return payload?.prompt ?? step.label ?? '';
}

function findStepById(def: WorkflowDef, id: string): { kind: string; label?: string } | null {
  const visit = (steps: readonly { id: string; kind: string; label?: string }[]): unknown => {
    for (const step of steps) {
      if (step.id === id) return step;
      if (step.kind === 'parallel') {
        const par = step as unknown as {
          branches?: Array<{ steps: typeof steps }>;
        };
        for (const branch of par.branches ?? []) {
          const found = visit(branch.steps);
          if (found) return found;
        }
      }
      if (step.kind === 'branch') {
        const br = step as unknown as { then?: typeof steps; otherwise?: typeof steps };
        if (br.then) {
          const found = visit(br.then);
          if (found) return found;
        }
        if (br.otherwise) {
          const found = visit(br.otherwise);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return visit(def.steps as readonly { id: string; kind: string; label?: string }[]) as {
    kind: string;
    label?: string;
  } | null;
}

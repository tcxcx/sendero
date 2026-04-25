/**
 * WorkflowRun bridge between the persisted Prisma row and the runner.
 *
 * The wizard surface (and other UI consumers) need to:
 *   - Load (or create) a run for a given (tenant, workflowId, surfaceKey).
 *   - Drive the runner forward, persisting the resulting checkpoint.
 *   - Project the row into the wizard-friendly snapshot shape.
 *
 * This module owns persistence so the runner stays runtime-neutral.
 */

import { prisma, Prisma } from '@sendero/database';
import {
  findWorkflow,
  resumeRun,
  startRun,
  type StepHooks,
  type ToolRegistry,
  type WorkflowDef,
  type WorkflowRun,
} from '@sendero/workflows';
import { toolList, type ToolContext } from '@sendero/tools';

import type { WizardRunSnapshot, WizardStepDef } from '@/components/channels/setup-wizard/types';

// ─── tool registry ────────────────────────────────────────────────────

/**
 * Build a runner registry from the canonical toolList. Wizard runs hand
 * the active tenant's traveler context so per-tenant tools (like
 * Kapso/Slack provisioning) can read it. The registry mirrors what the
 * chat route binds in /api/chat — call sites stay symmetric.
 */
export function buildWorkflowToolRegistry(ctx: ToolContext = {}): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const def of toolList) {
    registry[def.name] = args => def.handler(args, ctx);
  }
  return registry;
}

// ─── persistence helpers ──────────────────────────────────────────────

interface LoadOrStartArgs {
  tenantId: string;
  workflowId: string;
  surfaceKey: string;
  startedByUserId?: string;
  /** Initial input merged into scratchpad.input. */
  input?: Record<string, unknown>;
  ctx?: ToolContext;
}

/**
 * Get the open run for (tenant, surface) — start a fresh one if none
 * exists or the prior one has finished. Drives the runner up to the
 * first pause (or completion) and persists the snapshot before
 * returning. Wizard server components call this on every page load.
 */
export async function loadOrStartRun(args: LoadOrStartArgs): Promise<WizardRunSnapshot> {
  const def = findWorkflow(args.workflowId);
  if (!def) throw new Error(`unknown_workflow:${args.workflowId}`);

  const existing = await prisma.workflowRun.findUnique({
    where: { tenantId_surfaceKey: { tenantId: args.tenantId, surfaceKey: args.surfaceKey } },
  });

  if (existing && existing.status !== 'completed' && existing.status !== 'failed') {
    return projectRunRow(existing, def);
  }

  const tools = buildWorkflowToolRegistry(args.ctx);
  const run = await startRun({
    workflow: def,
    input: args.input ?? { tenantId: args.tenantId },
    tools,
  });

  const row = await persistRun({
    tenantId: args.tenantId,
    workflowId: def.id,
    surfaceKey: args.surfaceKey,
    startedByUserId: args.startedByUserId ?? null,
    run,
    existingId:
      existing?.status === 'completed' || existing?.status === 'failed'
        ? null
        : (existing?.id ?? null),
  });
  return projectRunRow(row, def);
}

interface ResumeArgs {
  tenantId: string;
  runId: string;
  resolution: Record<string, unknown>;
  ctx?: ToolContext;
}

/**
 * Resume a paused run with the operator's form values, persist the
 * resulting checkpoint, and return the projected snapshot.
 */
export async function resumePersistedRun(args: ResumeArgs): Promise<WizardRunSnapshot> {
  const row = await prisma.workflowRun.findUnique({ where: { id: args.runId } });
  if (!row) throw new Error('workflow_run_not_found');
  if (row.tenantId !== args.tenantId) throw new Error('workflow_run_tenant_mismatch');
  if (row.status !== 'paused') throw new Error(`workflow_run_not_paused:${row.status}`);
  const def = findWorkflow(row.workflowId);
  if (!def) throw new Error(`unknown_workflow:${row.workflowId}`);

  const tools = buildWorkflowToolRegistry(args.ctx);
  const previous: WorkflowRun = rowToRunnerRun(row);
  const next = await resumeRun({
    workflow: def,
    run: previous,
    resolution: args.resolution,
    tools,
  });

  const persisted = await persistRun({
    tenantId: row.tenantId,
    workflowId: row.workflowId,
    surfaceKey: row.surfaceKey,
    startedByUserId: row.startedByUserId,
    run: next,
    existingId: row.id,
  });
  return projectRunRow(persisted, def);
}

// ─── projection / row helpers ─────────────────────────────────────────

interface PersistArgs {
  tenantId: string;
  workflowId: string;
  surfaceKey: string | null;
  startedByUserId: string | null;
  run: WorkflowRun;
  existingId: string | null;
}

async function persistRun(args: PersistArgs) {
  const data = {
    tenantId: args.tenantId,
    workflowId: args.workflowId,
    status: args.run.status,
    scratchpad: args.run.scratchpad as Prisma.InputJsonValue,
    trail: args.run.trail as unknown as Prisma.InputJsonValue,
    currentStepId: args.run.nextStepId ?? null,
    pauseReason: args.run.pauseReason ?? null,
    pausePayload: (args.run.pausePayload ?? null) as Prisma.InputJsonValue | null,
    surfaceKey: args.surfaceKey,
    startedByUserId: args.startedByUserId,
    errorStepId: args.run.error?.stepId ?? null,
    errorMessage: args.run.error?.message ?? null,
    pausedAt: args.run.pausedAt ?? null,
    finishedAt: args.run.finishedAt ?? null,
  };

  if (args.existingId) {
    return prisma.workflowRun.update({ where: { id: args.existingId }, data });
  }
  return prisma.workflowRun.create({
    data: {
      ...data,
      startedAt: args.run.startedAt,
    },
  });
}

function rowToRunnerRun(row: {
  id: string;
  workflowId: string;
  status: string;
  scratchpad: Prisma.JsonValue;
  trail: Prisma.JsonValue;
  currentStepId: string | null;
  pauseReason: string | null;
  pausePayload: Prisma.JsonValue | null;
  startedAt: Date;
  pausedAt: Date | null;
  finishedAt: Date | null;
  errorStepId: string | null;
  errorMessage: string | null;
}): WorkflowRun {
  return {
    workflowId: row.workflowId,
    runId: row.id,
    status: row.status as WorkflowRun['status'],
    scratchpad: (row.scratchpad as Record<string, unknown>) ?? {},
    trail: (row.trail as unknown as WorkflowRun['trail']) ?? [],
    nextStepId: row.currentStepId ?? undefined,
    pauseReason: (row.pauseReason as WorkflowRun['pauseReason']) ?? undefined,
    pausePayload: (row.pausePayload as Record<string, unknown> | null) ?? undefined,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    error:
      row.errorStepId && row.errorMessage
        ? { stepId: row.errorStepId, message: row.errorMessage }
        : undefined,
  };
}

/**
 * Project a persisted WorkflowRun row to the WizardRunSnapshot the
 * client expects. Only **pause** steps surface as wizard rail entries —
 * tool steps execute between pauses without operator input.
 */
function projectRunRow(
  row: {
    id: string;
    workflowId: string;
    status: string;
    scratchpad: Prisma.JsonValue;
    currentStepId: string | null;
    pausePayload: Prisma.JsonValue | null;
    errorStepId: string | null;
    errorMessage: string | null;
    trail: Prisma.JsonValue;
  },
  def: WorkflowDef
): WizardRunSnapshot {
  const pauseSteps = collectPauseSteps(def);
  const trail = (row.trail as { stepId: string; ok: boolean }[]) ?? [];
  const completedIds = new Set(trail.filter(t => t.ok).map(t => t.stepId));
  const activeId = row.currentStepId;
  const steps: WizardStepDef[] = pauseSteps.map((s, i) => ({
    id: s.id,
    label: s.label,
    promptId: typeof s.payload?.promptId === 'string' ? s.payload.promptId : undefined,
    status: completedIds.has(s.id) ? 'completed' : activeId === s.id ? 'active' : 'pending',
    index: i + 1,
  }));
  const activeStep = steps.find(s => s.id === activeId);

  return {
    runId: row.id,
    workflowId: row.workflowId,
    workflowLabel: def.label,
    status: row.status as WizardRunSnapshot['status'],
    scratchpad: (row.scratchpad as Record<string, unknown>) ?? {},
    steps,
    activeStep,
    activePayload: (row.pausePayload as Record<string, unknown> | null) ?? undefined,
    error:
      row.errorStepId && row.errorMessage
        ? { stepId: row.errorStepId, message: row.errorMessage }
        : undefined,
  };
}

interface PauseStepWithPayload {
  id: string;
  label: string;
  payload?: Record<string, unknown>;
}

/** Walk the workflow tree and surface every `pause` step in canonical order. */
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

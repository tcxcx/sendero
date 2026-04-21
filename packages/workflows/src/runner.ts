/**
 * Workflow runner.
 *
 * Executes a WorkflowDef against an injected ToolRegistry. Pause steps
 * suspend the run and return control to the caller with `nextStepId`
 * pointing at the paused step; `resumeRun()` takes the persisted
 * run + any payload the pause was waiting for and continues from there.
 *
 * The runner is runtime-neutral — it does NOT call Prisma or Liveblocks
 * directly. The caller passes:
 *   - `tools`  : map of tool name → async function
 *   - `onStep` : optional side-effect hook (for analytics, meter, UI)
 *   - `onPause`: optional side-effect hook when a pause triggers
 */

import type {
  BranchStep,
  JsonPath,
  ParallelStep,
  PauseStep,
  StepTrailEntry,
  ToolStep,
  WorkflowDef,
  WorkflowRun,
  WorkflowStep,
} from './types';

export type ToolFn = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolRegistry {
  [name: string]: ToolFn;
}

export interface StepHooks {
  /** Fires AFTER each step resolves (success or failure). */
  onStep?: (entry: StepTrailEntry) => void | Promise<void>;
  /** Fires when the workflow pauses. Persist this so resumeRun() has the run. */
  onPause?: (args: {
    runId: string;
    step: PauseStep;
    scratchpad: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface StartRunArgs<I = unknown> {
  workflow: WorkflowDef<I>;
  input?: Record<string, unknown>;
  tools: ToolRegistry;
  hooks?: StepHooks;
  /** Provide a custom runId (idempotency). Defaults to crypto.randomUUID. */
  runId?: string;
}

export async function startRun(args: StartRunArgs): Promise<WorkflowRun> {
  const runId = args.runId ?? crypto.randomUUID();
  const startedAt = new Date();
  const scratchpad: Record<string, unknown> = { input: args.input ?? {} };
  const trail: StepTrailEntry[] = [];

  return executeSteps(args.workflow, args.workflow.steps, {
    runId,
    startedAt,
    scratchpad,
    trail,
    tools: args.tools,
    hooks: args.hooks,
  });
}

export interface ResumeRunArgs {
  workflow: WorkflowDef;
  run: WorkflowRun;
  /** Payload the pause was waiting for — merged into scratchpad under the step id. */
  resolution: Record<string, unknown>;
  tools: ToolRegistry;
  hooks?: StepHooks;
}

/**
 * Resume a paused run. Merges `resolution` into the scratchpad at the
 * paused step's id, advances past the pause, and continues executing.
 */
export async function resumeRun(args: ResumeRunArgs): Promise<WorkflowRun> {
  if (args.run.status !== 'paused' || !args.run.nextStepId) {
    throw new Error('resumeRun: run is not paused or missing nextStepId');
  }
  const scratchpad = { ...args.run.scratchpad, [args.run.nextStepId]: args.resolution };
  const trail = [...args.run.trail];

  // Append the now-resolved pause entry to the trail so it's not re-run.
  trail.push({
    stepId: args.run.nextStepId,
    kind: 'pause',
    label: `resumed (${args.run.pauseReason ?? 'external_event'})`,
    startedAt: args.run.pausedAt ?? args.run.startedAt,
    finishedAt: new Date(),
    ok: true,
    output: args.resolution,
  });

  const remaining = stepsAfter(args.workflow.steps, args.run.nextStepId);
  return executeSteps(args.workflow, remaining, {
    runId: args.run.runId,
    startedAt: args.run.startedAt,
    scratchpad,
    trail,
    tools: args.tools,
    hooks: args.hooks,
  });
}

// ─── internal execution ────────────────────────────────────────────────

interface ExecContext {
  runId: string;
  startedAt: Date;
  scratchpad: Record<string, unknown>;
  trail: StepTrailEntry[];
  tools: ToolRegistry;
  hooks?: StepHooks;
}

async function executeSteps(
  workflow: WorkflowDef,
  steps: WorkflowStep[],
  ctx: ExecContext
): Promise<WorkflowRun> {
  for (const step of steps) {
    if (step.kind === 'pause') {
      await ctx.hooks?.onPause?.({
        runId: ctx.runId,
        step,
        scratchpad: ctx.scratchpad,
      });
      return {
        workflowId: workflow.id,
        runId: ctx.runId,
        status: 'paused',
        startedAt: ctx.startedAt,
        pausedAt: new Date(),
        pauseReason: step.reason,
        pausePayload: step.payload,
        scratchpad: ctx.scratchpad,
        trail: ctx.trail,
        nextStepId: step.id,
      };
    }

    const result = await runSingleStep(workflow, step, ctx);
    if (result.status === 'failed') return result;
  }

  return {
    workflowId: workflow.id,
    runId: ctx.runId,
    status: 'completed',
    startedAt: ctx.startedAt,
    finishedAt: new Date(),
    scratchpad: ctx.scratchpad,
    trail: ctx.trail,
  };
}

async function runSingleStep(
  workflow: WorkflowDef,
  step: WorkflowStep,
  ctx: ExecContext
): Promise<WorkflowRun> {
  const stepStartedAt = new Date();
  try {
    switch (step.kind) {
      case 'tool':
        return await runToolStep(workflow, step, ctx, stepStartedAt);
      case 'branch':
        return await runBranchStep(workflow, step, ctx, stepStartedAt);
      case 'parallel':
        return await runParallelStep(workflow, step, ctx, stepStartedAt);
      case 'pause':
        throw new Error('pause should be handled by executeSteps');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.trail.push({
      stepId: step.id,
      kind: step.kind,
      label: step.label,
      startedAt: stepStartedAt,
      finishedAt: new Date(),
      ok: false,
      error: message,
    });
    await ctx.hooks?.onStep?.(ctx.trail[ctx.trail.length - 1]);
    return {
      workflowId: workflow.id,
      runId: ctx.runId,
      status: 'failed',
      startedAt: ctx.startedAt,
      finishedAt: new Date(),
      scratchpad: ctx.scratchpad,
      trail: ctx.trail,
      error: { stepId: step.id, message },
    };
  }
}

async function runToolStep(
  workflow: WorkflowDef,
  step: ToolStep,
  ctx: ExecContext,
  startedAt: Date
): Promise<WorkflowRun> {
  const tool = ctx.tools[step.tool];
  if (!tool) throw new Error(`Unknown tool: ${step.tool}`);

  const resolvedArgs = resolveArgs(step.args, ctx.scratchpad);

  const maxAttempts = 1 + (step.retries ?? 0);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = step.timeoutMs
        ? await withTimeout(tool(resolvedArgs), step.timeoutMs, step.tool)
        : await tool(resolvedArgs);
      if (step.as) ctx.scratchpad[step.as] = output;
      ctx.scratchpad[step.id] = output;
      const entry: StepTrailEntry = {
        stepId: step.id,
        kind: 'tool',
        label: step.label,
        startedAt,
        finishedAt: new Date(),
        ok: true,
        output,
      };
      ctx.trail.push(entry);
      await ctx.hooks?.onStep?.(entry);
      return continueRun(workflow, ctx);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      // exponential backoff — 100ms, 300ms, 900ms
      await sleep(100 * 3 ** (attempt - 1));
    }
  }
  throw lastErr;
}

async function runBranchStep(
  workflow: WorkflowDef,
  step: BranchStep,
  ctx: ExecContext,
  startedAt: Date
): Promise<WorkflowRun> {
  const observed = resolvePath(ctx.scratchpad, step.when.path);
  const predicate = step.equals !== undefined ? observed === step.equals : Boolean(observed);
  ctx.trail.push({
    stepId: step.id,
    kind: 'branch',
    label: step.label,
    startedAt,
    finishedAt: new Date(),
    ok: true,
    output: { matched: predicate },
  });
  await ctx.hooks?.onStep?.(ctx.trail[ctx.trail.length - 1]);

  const branchSteps = predicate ? step.then : (step.otherwise ?? []);
  return executeSteps(workflow, branchSteps, ctx);
}

async function runParallelStep(
  workflow: WorkflowDef,
  step: ParallelStep,
  ctx: ExecContext,
  startedAt: Date
): Promise<WorkflowRun> {
  const perBranchRuns = await Promise.all(
    step.branches.map(async branch => {
      const subScratch: Record<string, unknown> = { ...ctx.scratchpad };
      const subTrail: StepTrailEntry[] = [];
      const subRun = await executeSteps(workflow, branch.steps, {
        runId: ctx.runId,
        startedAt: ctx.startedAt,
        scratchpad: subScratch,
        trail: subTrail,
        tools: ctx.tools,
        hooks: ctx.hooks,
      });
      return { branchId: branch.id, run: subRun, scratch: subScratch, trail: subTrail };
    })
  );

  // Merge sub-branch outputs into the parent scratchpad under the branch id.
  const parallelOut: Record<string, unknown> = {};
  for (const b of perBranchRuns) {
    parallelOut[b.branchId] = b.scratch;
    ctx.trail.push(...b.trail);
  }
  ctx.scratchpad[step.id] = parallelOut;

  const anyFailed = perBranchRuns.find(b => b.run.status === 'failed');
  if (anyFailed && step.failFast !== false) {
    throw new Error(
      `parallel branch '${anyFailed.branchId}' failed: ${anyFailed.run.error?.message ?? 'unknown'}`
    );
  }

  ctx.trail.push({
    stepId: step.id,
    kind: 'parallel',
    label: step.label,
    startedAt,
    finishedAt: new Date(),
    ok: !anyFailed,
    output: parallelOut,
  });
  await ctx.hooks?.onStep?.(ctx.trail[ctx.trail.length - 1]);

  return continueRun(workflow, ctx);
}

function continueRun(workflow: WorkflowDef, ctx: ExecContext): WorkflowRun {
  return {
    workflowId: workflow.id,
    runId: ctx.runId,
    status: 'completed', // overwritten by executeSteps when appropriate
    startedAt: ctx.startedAt,
    finishedAt: new Date(),
    scratchpad: ctx.scratchpad,
    trail: ctx.trail,
  };
}

// ─── utilities ────────────────────────────────────────────────────────

function isJsonPath(value: unknown): value is JsonPath {
  return typeof value === 'object' && value !== null && 'path' in value;
}

function resolveArgs(
  args: Record<string, unknown> | JsonPath,
  scratchpad: Record<string, unknown>
): Record<string, unknown> {
  if (isJsonPath(args)) {
    const resolved = resolvePath(scratchpad, args.path);
    return typeof resolved === 'object' && resolved !== null
      ? (resolved as Record<string, unknown>)
      : {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = isJsonPath(v) ? resolvePath(scratchpad, v.path) : v;
  }
  return out;
}

function resolvePath(root: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as object)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function stepsAfter(steps: WorkflowStep[], afterId: string): WorkflowStep[] {
  const found = stepsAfterInner(steps, afterId);
  // If the pause wasn't located anywhere in the tree, fall back to the
  // whole workflow — callers depend on this to handle unknown ids by
  // replaying from the start. Nested calls MUST NOT hit this fallback
  // since that would inject unrelated branch steps on resume.
  return found ?? steps;
}

function stepsAfterInner(steps: WorkflowStep[], afterId: string): WorkflowStep[] | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.id === afterId) return steps.slice(i + 1);
    // Dive into nested containers so resume works from inside a branch.
    if (step.kind === 'branch') {
      const found = stepsAfterInner(step.then, afterId);
      if (found !== null) return [...found, ...steps.slice(i + 1)];
      if (step.otherwise) {
        const elseFound = stepsAfterInner(step.otherwise, afterId);
        if (elseFound !== null) return [...elseFound, ...steps.slice(i + 1)];
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tool '${toolName}' timed out after ${ms}ms`)), ms);
  });
  try {
    return (await Promise.race([promise, timeout])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

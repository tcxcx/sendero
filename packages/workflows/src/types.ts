/**
 * Declarative workflow shape.
 *
 * A WorkflowDef is a deterministic DAG of steps with typed inputs. Each
 * step is one of four kinds:
 *   - `tool`   — call a tool from @sendero/tools. Output is keyed by `as`.
 *   - `branch` — conditional split based on prior step output.
 *   - `pause`  — suspend execution awaiting an external signal (human
 *                approval, OTP, payment confirmation). Runner persists
 *                checkpoint, returns control.
 *   - `parallel` — run a set of sub-steps concurrently, collect outputs.
 *
 * Workflows are JSON-serializable so the same plan can be authored in
 * code, stored in Prisma, or emitted by the LLM itself as a structured
 * plan and replayed.
 */

export type StepKind = 'tool' | 'branch' | 'pause' | 'parallel';

export interface ToolStep {
  kind: 'tool';
  id: string;
  tool: string; // tool name from the injected catalog
  label: string;
  args: Record<string, unknown> | JsonPath;
  /** Key the tool's output under this name in the step scratchpad. */
  as?: string;
  /** Retry policy; defaults to no retry. */
  retries?: number;
  /** Max latency the step should tolerate, in ms. */
  timeoutMs?: number;
}

export interface BranchStep {
  kind: 'branch';
  id: string;
  label: string;
  /** JSONPath-ish lookup into scratchpad (e.g. `policy.allowed`). */
  when: JsonPath;
  equals?: unknown;
  /** If the predicate holds, run `then`; otherwise run `otherwise`. */
  then: WorkflowStep[];
  otherwise?: WorkflowStep[];
}

export interface PauseStep {
  kind: 'pause';
  id: string;
  label: string;
  /** Reason that downstream consumers can match on ("approval", "otp"). */
  reason:
    | 'approval'
    | 'otp'
    | '3ds'
    | 'user_reply'
    | 'external_event'
    /** Traveler-document verdict is 'block' — wait for the traveler
     *  to upload a fresh passport or update their declared profile
     *  before the booking flow proceeds. Surfaces on the trip page
     *  as a remediation card. */
    | 'eligibility_blocked';
  /** Timeout in ms before the pause auto-fails. Default: no timeout. */
  timeoutMs?: number;
  /** Arbitrary metadata for the UI (approver id, prompt text, etc.). */
  payload?: Record<string, unknown>;
}

export interface ParallelStep {
  kind: 'parallel';
  id: string;
  label: string;
  branches: Array<{ id: string; steps: WorkflowStep[] }>;
  /** fail-fast aborts sibling branches when any branch errors. */
  failFast?: boolean;
}

export type WorkflowStep = ToolStep | BranchStep | PauseStep | ParallelStep;

/** Simple JSON-path-ish reference into the workflow scratchpad. */
export type JsonPath = { path: string };

export function $(path: string): JsonPath {
  return { path };
}

export interface WorkflowDef<I = unknown> {
  /** Stable id used for Prisma checkpoint keying. */
  id: string;
  version: number;
  label: string;
  description?: string;
  /** Optional input schema — runner coerces / validates with caller-provided zod. */
  input?: I;
  steps: WorkflowStep[];
  /**
   * Operator-only workflow — never advertised to external API keys,
   * MCP clients, or customer-facing channels.  Defaults to `false`.
   *
   * Mark `internal: true` for tenant-admin orchestrations
   * (channel provisioning wizards, vault rotation drills, payout-
   * runs that should never be triggered by an external agent or
   * prompt-injected through a customer chat).
   *
   * Filtering happens at `listWorkflows()` consumer sites — the
   * canonical registry stays complete; surfaces decide what they
   * advertise.
   */
  internal?: boolean;
}

/** Run-time runner output. */
export interface WorkflowRun {
  workflowId: string;
  runId: string;
  status: 'completed' | 'paused' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  pausedAt?: Date;
  pauseReason?: PauseStep['reason'];
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
  trail: StepTrailEntry[];
  /** The step that is next to execute when resuming from a pause. */
  nextStepId?: string;
  error?: { stepId: string; message: string };
}

export interface StepTrailEntry {
  stepId: string;
  kind: StepKind;
  label: string;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  /** Tool price if the step was a metered tool call. */
  priceMicroUsdc?: bigint;
  output?: unknown;
  error?: string;
}

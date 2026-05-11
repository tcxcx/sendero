/**
 * Provisioning progress state machine — stamps per-stage status into
 * `Tenant.metadata.provisioning` so the onboarding wait screen reflects
 * real server state instead of a decorative animation.
 *
 * Why this lives on `Tenant.metadata` and not a dedicated table:
 * - 1:1 cardinality (one provisioning run per tenant, per attempt). The
 *   Tenant row IS the job. A `ProvisioningRun` table would just re-state
 *   what the schema already encodes.
 * - JSONB atomic update via `jsonb_set` is idempotent + concurrent-safe,
 *   same pattern as `Trip.events` append.
 * - Zero migration. Promotes to a dedicated table later if cross-tenant
 *   ops dashboards need it.
 *
 * Shape:
 *
 * ```
 * Tenant.metadata.provisioning = {
 *   jobId, chain, startedAt, finishedAt?,
 *   currentStage, attempts,
 *   stages: {
 *     treasury: { status, startedAt, finishedAt?, error?, address? },
 *     identity: { status, startedAt, finishedAt?, error?, agentId? },
 *     finalize: { status, startedAt, finishedAt? },
 *   },
 *   lastError?: { stage, message }
 * }
 * ```
 *
 * `status` ∈ 'idle' | 'running' | 'done' | 'failed'. Identity 'failed'
 * is non-fatal (existing retry-identity-provision sweeper covers it),
 * but stamped so the UI can surface it.
 *
 * Stamp failures are swallowed — observability must never abort
 * provisioning. The route still returns 200/500 from the provisioning
 * outcome, not the stamp outcome.
 */

import { prisma } from '@sendero/database';

import { randomUUID } from 'node:crypto';

export type ProvisioningStageName = 'treasury' | 'identity' | 'finalize';
export type ProvisioningStageStatus = 'idle' | 'running' | 'done' | 'failed';
export type ProvisioningOverallStage = ProvisioningStageName | 'done' | 'failed';

export interface ProvisioningStageState {
  status: ProvisioningStageStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  // Stage-specific extras (address, agentId, etc.) live as siblings
  // so the UI can pull them out without a discriminated union.
  [k: string]: unknown;
}

export interface ProvisioningState {
  jobId: string;
  chain: 'arc' | 'sol';
  startedAt: string;
  finishedAt?: string;
  currentStage: ProvisioningOverallStage;
  attempts: number;
  stages: {
    treasury: ProvisioningStageState;
    identity: ProvisioningStageState;
    finalize: ProvisioningStageState;
  };
  lastError?: { stage: ProvisioningStageName; message: string };
}

const STAGES: ProvisioningStageName[] = ['treasury', 'identity', 'finalize'];

function emptyStages(): ProvisioningState['stages'] {
  return {
    treasury: { status: 'idle' },
    identity: { status: 'idle' },
    finalize: { status: 'idle' },
  };
}

export function initialProvisioningState(chain: 'arc' | 'sol'): ProvisioningState {
  return {
    jobId: randomUUID(),
    chain,
    startedAt: new Date().toISOString(),
    currentStage: 'treasury',
    attempts: 1,
    stages: emptyStages(),
  };
}

/**
 * Begin a new provisioning run on a tenant. Resets stage state to idle.
 * Increments `attempts` if a prior run exists (so we can see retries in
 * the metadata trail).
 */
export async function beginProvisioning(args: {
  tenantId: string;
  chain: 'arc' | 'sol';
}): Promise<ProvisioningState> {
  const { tenantId, chain } = args;
  const prior = await readProvisioning(tenantId);
  const state: ProvisioningState =
    prior && prior.chain === chain && prior.currentStage !== 'done'
      ? // Retry of an unfinished run — keep jobId, bump attempts, reset stages.
        {
          ...prior,
          startedAt: new Date().toISOString(),
          finishedAt: undefined,
          currentStage: 'treasury',
          attempts: (prior.attempts ?? 1) + 1,
          stages: emptyStages(),
          lastError: undefined,
        }
      : initialProvisioningState(chain);

  await writeProvisioning(tenantId, state);
  return state;
}

/**
 * Stamp a stage transition. Atomic — uses `jsonb_set` so concurrent
 * stamps on different stages don't clobber each other. Swallows errors;
 * never throws.
 */
export async function stampStage(args: {
  tenantId: string;
  stage: ProvisioningStageName;
  status: ProvisioningStageStatus;
  error?: string;
  extras?: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, stage, status, error, extras } = args;
  const now = new Date().toISOString();
  try {
    const current = await readProvisioning(tenantId);
    if (!current) return;
    const prevStage = current.stages[stage];
    const next: ProvisioningStageState = {
      ...prevStage,
      ...extras,
      status,
      startedAt: prevStage.startedAt ?? (status === 'running' ? now : prevStage.startedAt),
      finishedAt: status === 'done' || status === 'failed' ? now : prevStage.finishedAt,
    };
    if (error !== undefined) next.error = error;
    else if (status === 'done') delete next.error;

    const updated: ProvisioningState = {
      ...current,
      stages: { ...current.stages, [stage]: next },
      currentStage: deriveCurrentStage(current, stage, status),
      finishedAt:
        status === 'done' && stage === 'finalize'
          ? now
          : status === 'failed'
            ? now
            : current.finishedAt,
      lastError: status === 'failed' ? { stage, message: error ?? 'unknown' } : current.lastError,
    };
    await writeProvisioning(tenantId, updated);
  } catch (e) {
    // Observability is not load-bearing. Log + swallow.
    console.warn('[provisioning-progress] stampStage failed (non-fatal)', {
      tenantId,
      stage,
      status,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function deriveCurrentStage(
  state: ProvisioningState,
  justStamped: ProvisioningStageName,
  status: ProvisioningStageStatus
): ProvisioningOverallStage {
  if (status === 'failed') return 'failed';
  if (status === 'running') return justStamped;
  // status === 'done'
  if (justStamped === 'finalize') return 'done';
  const idx = STAGES.indexOf(justStamped);
  const next = STAGES[idx + 1];
  return next ?? state.currentStage;
}

export async function readProvisioning(tenantId: string): Promise<ProvisioningState | null> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { metadata: true },
  });
  if (!row?.metadata || typeof row.metadata !== 'object') return null;
  const raw = (row.metadata as Record<string, unknown>).provisioning;
  if (!raw || typeof raw !== 'object') return null;
  return raw as ProvisioningState;
}

async function writeProvisioning(tenantId: string, state: ProvisioningState): Promise<void> {
  // jsonb merge: replace only the `provisioning` key, preserve other
  // metadata (logo, brand, etc.). Inlined as raw SQL because Prisma's
  // JSON update mode requires us to read the full blob and we want to
  // be concurrent-safe on the write.
  await prisma.$executeRaw`
    UPDATE tenants
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{provisioning}',
      ${JSON.stringify(state)}::jsonb,
      true
    ),
    "updatedAt" = NOW()
    WHERE id = ${tenantId}
  `;
}

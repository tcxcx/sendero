/**
 * /dashboard/settings/pricing — markup policy activation + management.
 *
 * Server Component shell. Loads the latest TenantPricingPolicy row +
 * the per-kind historical recommendation placeholders, derives the
 * five activation states, and hands the wizard the right starting
 * point:
 *
 *   not_initialized  → Step 1 (kind chips)
 *   sandbox_seed     → Step 2 with seeded values + banner
 *   inactive/partial → Step 2 with current values, "Update + activate"
 *   active           → Step 2 pre-filled, "Update markup policy"
 *
 * The wizard handles its own POST to `/api/tenant/pricing-policy`.
 *
 * Recommendations come from `Booking.markupBps` aggregates per kind
 * (median is the right summary because hotels skew long-tail). The
 * per-tenant cron from Track E4 will write a denormalized table; until
 * then we do the aggregate inline and surface "—" when the sample
 * size is too small (<20 confirmed bookings per kind).
 */

import { prisma } from '@sendero/database';

import { currentOrgPlanTier } from '@/lib/billing-plan';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { CORE_BOOKING_KINDS } from '@sendero/billing';

import { PricingPolicyWizard, type ExistingPolicy } from './wizard';

export const dynamic = 'force-dynamic';

// Settings UI shows core kinds only. eSIM + card markup configuration
// will get a dedicated section once the surfaces ship (so tenants don't
// see an empty config slot for products they don't sell yet).
const ALL_KINDS = CORE_BOOKING_KINDS;
type Kind = (typeof ALL_KINDS)[number];

const MIN_SAMPLE_FOR_RECO = 20;

export default async function PricingSettingsPage() {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const planTier = await currentOrgPlanTier();

  const policy = await prisma.tenantPricingPolicy.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { version: 'desc' },
  });

  const recommendations = await loadRecommendations(tenant.id);

  // Derive the existing-policy view the wizard expects.
  let existing: ExistingPolicy;
  if (!policy) {
    existing = {
      status: 'not_initialized',
      markupConfig: {},
      floorMicroUsdc: 1_000_000n,
      ceilingMicroUsdc: null,
      senderoTakeBehavior: 'add_to_customer',
      policyVersion: null,
      recommendations,
    };
  } else {
    const cfg = parseMarkupConfig(policy.markupConfig);
    const status: ExistingPolicy['status'] = policy.sandboxOnly
      ? 'sandbox_seed'
      : !policy.activated
        ? 'inactive'
        : Object.keys(cfg).length < ALL_KINDS.length
          ? 'partial'
          : 'active';
    existing = {
      status,
      markupConfig: cfg,
      floorMicroUsdc: policy.floorMicroUsdc,
      ceilingMicroUsdc: policy.ceilingMicroUsdc,
      senderoTakeBehavior:
        policy.senderoTakeBehavior === 'deduct_from_markup'
          ? 'deduct_from_markup'
          : 'add_to_customer',
      policyVersion: policy.version,
      recommendations,
    };
  }

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        flex: 1,
        minHeight: 0,
      }}
    >
      <div>
        <h1 className="t-h1">{headerFor(existing.status)}</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          {ledeFor(existing.status)}
        </p>
      </div>

      {existing.status === 'sandbox_seed' ? (
        <div
          role="status"
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--tint-sand-soft, #fdf6e3)',
            boxShadow: 'inset 0 0 0 1px var(--sand-deep, #c9a651)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span className="t-meta" style={{ color: 'var(--sand-deep, #8a6a1f)' }}>
            SANDBOX DEFAULTS
          </span>
          <span className="t-body" style={{ fontSize: 13 }}>
            You&apos;re using the sandbox seed. Set your real markup to start quoting production
            bookings — sandbox keys keep working through the transition.
          </span>
        </div>
      ) : null}

      {existing.status === 'partial' ? (
        <div
          role="status"
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--tint-vermillion-soft)',
            boxShadow: 'inset 0 0 0 1px var(--vermillion)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span className="t-meta" style={{ color: 'var(--vermillion)' }}>
            PARTIAL POLICY
          </span>
          <span className="t-body" style={{ fontSize: 13 }}>
            Your policy covers some categories but not all. The agent will refuse to quote{' '}
            <code className="t-mono" style={{ fontSize: 12 }}>
              {ALL_KINDS.filter(k => !(k in existing.markupConfig)).join(', ')}
            </code>{' '}
            bookings until you complete the configuration.
          </span>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 18,
          // Sticky right rail at >=1024px lives on a parent with a 2-col
          // grid; this page's wizard is wide-form so we keep one column.
        }}
      >
        <PricingPolicyWizard existing={existing} planTier={planTier} />
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function headerFor(status: ExistingPolicy['status']): string {
  if (status === 'active') return 'Update markup policy';
  if (status === 'sandbox_seed') return 'Activate your real markup policy';
  if (status === 'partial') return 'Finish your markup policy';
  if (status === 'inactive') return 'Activate your markup policy';
  return 'Set up your markup policy';
}

function ledeFor(status: ExistingPolicy['status']): string {
  if (status === 'active') {
    return 'Edits create a new pinned policy version. In-flight quotes keep the old version — only new quotes use the update.';
  }
  if (status === 'partial') {
    return 'Cover every category you sell so the agent never has to refuse a booking with POLICY_PARTIAL_FOR_KIND.';
  }
  return 'Three steps: pick what you sell, set per-category markup, preview a sample quote, then activate. Production confirms unlock the moment you save.';
}

function parseMarkupConfig(
  raw: unknown
): Partial<Record<Kind, { strategy: 'static'; bps: number }>> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<Kind, { strategy: 'static'; bps: number }>> = {};
  for (const k of ALL_KINDS) {
    const entry = obj[k];
    if (entry && typeof entry === 'object') {
      const e = entry as { strategy?: unknown; bps?: unknown };
      if (e.strategy === 'static' && typeof e.bps === 'number') {
        out[k] = { strategy: 'static', bps: e.bps };
      }
    }
  }
  return out;
}

/**
 * Per-kind historical median markupBps. Returns `{}` until the
 * recommendation cron lands (Track E4); inline aggregate for now.
 */
async function loadRecommendations(
  tenantId: string
): Promise<Partial<Record<Kind, { medianBps: number }>>> {
  const rows = await prisma.booking.findMany({
    where: {
      tenantId,
      markupBps: { not: null },
      // Earliest-date guard: rows without explicit markup tracking
      // pre-date v1 and shouldn't skew the median.
      NOT: { metadata: { path: ['markupSource'], equals: 'pre_v1_no_markup_recorded' } },
    },
    select: { kind: true, markupBps: true },
    take: 5_000,
    orderBy: { createdAt: 'desc' },
  });

  const buckets: Record<Kind, number[]> = {
    flight: [],
    hotel: [],
    rail: [],
    car: [],
    other: [],
  };
  for (const row of rows) {
    if (row.markupBps === null) continue;
    if (!isKind(row.kind)) continue;
    buckets[row.kind].push(row.markupBps);
  }

  const out: Partial<Record<Kind, { medianBps: number }>> = {};
  for (const k of ALL_KINDS) {
    const arr = buckets[k];
    if (arr.length < MIN_SAMPLE_FOR_RECO) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const median = arr.length % 2 === 0 ? Math.round((arr[mid - 1] + arr[mid]) / 2) : arr[mid];
    out[k] = { medianBps: median };
  }
  return out;
}

function isKind(value: unknown): value is Kind {
  return (
    value === 'flight' ||
    value === 'hotel' ||
    value === 'rail' ||
    value === 'car' ||
    value === 'other'
  );
}

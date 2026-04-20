/**
 * Spend analytics helpers for the admin dashboard.
 *
 * Storage-agnostic aggregation over MeterEvent rows — caller supplies a
 * narrow store interface. All returned totals are in micro-USDC.
 */

export interface AnalyticsStore {
  sumSpentInWindow: (args: { tenantId: string; from: Date; to: Date }) => Promise<bigint>;

  countCallsInWindow: (args: { tenantId: string; from: Date; to: Date }) => Promise<number>;

  spendByToolInWindow: (args: {
    tenantId: string;
    from: Date;
    to: Date;
  }) => Promise<Array<{ toolName: string; calls: number; micro: bigint }>>;

  /** Time-bucketed spend (hourly or daily) over the window. */
  spendTimeseries: (args: {
    tenantId: string;
    from: Date;
    to: Date;
    bucket: 'hour' | 'day';
  }) => Promise<Array<{ bucketStartedAt: Date; micro: bigint; calls: number }>>;
}

export interface TenantSpendSummary {
  tenantId: string;
  windowFrom: Date;
  windowTo: Date;
  totalMicro: bigint;
  totalCalls: number;
  perTool: Array<{ toolName: string; calls: number; micro: bigint }>;
  timeseries: Array<{ bucketStartedAt: Date; micro: bigint; calls: number }>;
}

export async function tenantSpendSummary(
  store: AnalyticsStore,
  args: {
    tenantId: string;
    from: Date;
    to: Date;
    bucket?: 'hour' | 'day';
  }
): Promise<TenantSpendSummary> {
  const bucket = args.bucket ?? 'day';
  const [totalMicro, totalCalls, perTool, timeseries] = await Promise.all([
    store.sumSpentInWindow({ tenantId: args.tenantId, from: args.from, to: args.to }),
    store.countCallsInWindow({ tenantId: args.tenantId, from: args.from, to: args.to }),
    store.spendByToolInWindow({ tenantId: args.tenantId, from: args.from, to: args.to }),
    store.spendTimeseries({
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
      bucket,
    }),
  ]);

  return {
    tenantId: args.tenantId,
    windowFrom: args.from,
    windowTo: args.to,
    totalMicro,
    totalCalls,
    perTool,
    timeseries,
  };
}

/** Margin delta vs running on Ethereum mainnet. Defensive default gas model. */
export interface EthereumMarginArgs {
  actualMicroOnArc: bigint;
  callCount: number;
  /** Assumed per-call gas on Ethereum in USD, default $0.41 (50 gwei × 80k gas × $2500 ETH). */
  ethereumPerCallUsd?: number;
}

export function arcMarginFactor(args: EthereumMarginArgs): number {
  const arcMicro = args.actualMicroOnArc;
  const ethPerCallUsd = args.ethereumPerCallUsd ?? 0.41;
  const ethTotalMicro = BigInt(Math.round(ethPerCallUsd * 1_000_000)) * BigInt(args.callCount);
  if (arcMicro === 0n) return Number(ethTotalMicro) / 1_000_000;
  return Number(ethTotalMicro) / Number(arcMicro);
}

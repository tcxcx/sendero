import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { formatDateTime, formatMicroUsd } from '@/lib/format';

type SpendSummary = {
  totalMicro: bigint;
  totalCalls: number;
  perTool: Array<{ toolName: string; calls: number; micro: bigint }>;
  timeseries: Array<{ bucketStartedAt: Date; micro: bigint; calls: number }>;
};

type CapRow = {
  period: string;
  amountMicroUsdc: bigint;
  hardCap: boolean;
};

type BatchRow = {
  id: string;
  status: string;
  totalMicroUsdc: bigint;
  eventCount: number;
  txHash: string | null;
  settledAt: Date | null;
  createdAt: Date;
};

export function SpendDashboard({
  tenantName,
  tier,
  days,
  summary,
  caps,
  recentBatches,
}: {
  tenantName: string;
  tier: string;
  days: number;
  summary: SpendSummary;
  caps: CapRow[];
  recentBatches: BatchRow[];
}) {
  const max = summary.timeseries.reduce(
    (acc, point) => (point.micro > acc ? point.micro : acc),
    0n
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label={`Spend · ${days}d`} value={formatMicroUsd(summary.totalMicro)} />
        <Kpi label={`Calls · ${days}d`} value={summary.totalCalls.toLocaleString()} />
        <Kpi label="Tenant" value={tenantName} sub={tier} />
        <Kpi
          label="Batches settled"
          value={String(recentBatches.filter(batch => batch.status === 'settled').length)}
          sub={`${recentBatches.length} recent`}
        />
      </div>

      <Panel title="Spend per day">
        {summary.timeseries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paid meter events in this window.</p>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {summary.timeseries.map(point => {
              const height =
                max === 0n ? 2 : Math.max(2, Math.round((Number(point.micro) / Number(max)) * 120));
              return (
                <div
                  key={point.bucketStartedAt.toISOString()}
                  className="min-w-3 flex-1 rounded-sm bg-primary"
                  style={{ height }}
                  title={`${point.bucketStartedAt.toISOString().slice(0, 10)} · ${formatMicroUsd(point.micro)} · ${point.calls} calls`}
                />
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Spend per tool">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Calls</TableHead>
              <TableHead>Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.perTool.map(row => (
              <TableRow key={row.toolName}>
                <TableCell className="font-mono text-xs">{row.toolName}</TableCell>
                <TableCell style={{ fontVariantNumeric: 'tabular-nums' }}>{row.calls}</TableCell>
                <TableCell style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMicroUsd(row.micro)}
                </TableCell>
              </TableRow>
            ))}
            {summary.perTool.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No tool calls in this window.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Caps">
          <div className="flex flex-col">
            {caps.map((cap, index) => (
              <div
                key={cap.period}
                className="flex items-center justify-between py-3 text-sm"
                style={{
                  borderBottom: index < caps.length - 1 ? 'var(--hairline-soft)' : undefined,
                }}
              >
                <span>{cap.period}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMicroUsd(cap.amountMicroUsdc)} · {cap.hardCap ? 'hard' : 'soft'}
                </span>
              </div>
            ))}
            {caps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No caps configured.</p>
            ) : null}
          </div>
        </Panel>

        <Panel title="Recent batches">
          <div className="flex flex-col">
            {recentBatches.map((batch, index) => (
              <div
                key={batch.id}
                className="flex items-center justify-between py-3 text-sm"
                style={{
                  borderBottom:
                    index < recentBatches.length - 1 ? 'var(--hairline-soft)' : undefined,
                }}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs">{batch.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(batch.settledAt ?? batch.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={batch.status} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMicroUsd(batch.totalMicroUsdc)}
                  </span>
                </div>
              </div>
            ))}
            {recentBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No batches yet.</p>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
      <h3 className="text-[15px] font-semibold tracking-normal text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-5 shadow-[var(--shadow-md)]">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{
          fontSize: 'var(--label-meta, 0.6875rem)',
          letterSpacing: 'var(--label-meta-tracking, 0.12em)',
        }}
      >
        {label}
      </div>
      <div
        className="truncate text-2xl font-semibold tracking-normal"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const bg =
    status === 'settled'
      ? 'var(--tint-sea-soft)'
      : status === 'pending'
        ? 'var(--tint-sand-soft)'
        : 'var(--tint-midnight-soft)';
  return (
    <span
      className="inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium text-foreground"
      style={{ backgroundColor: bg }}
    >
      {status}
    </span>
  );
}

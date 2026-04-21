import { Badge } from '@sendero/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
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

      <Card>
        <CardHeader>
          <CardTitle>Spend per day</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.timeseries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paid meter events in this window.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {summary.timeseries.map(point => {
                const height =
                  max === 0n
                    ? 2
                    : Math.max(2, Math.round((Number(point.micro) / Number(max)) * 120));
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spend per tool</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell>{row.calls}</TableCell>
                  <TableCell>{formatMicroUsd(row.micro)}</TableCell>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Caps</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {caps.map(cap => (
              <div
                key={cap.period}
                className="flex items-center justify-between border-b border-border py-2 text-sm"
              >
                <span>{cap.period}</span>
                <span>
                  {formatMicroUsd(cap.amountMicroUsdc)} · {cap.hardCap ? 'hard' : 'soft'}
                </span>
              </div>
            ))}
            {caps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No caps configured.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent batches</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentBatches.map(batch => (
              <div
                key={batch.id}
                className="flex items-center justify-between border-b border-border py-2 text-sm"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs">{batch.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(batch.settledAt ?? batch.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={batch.status === 'settled' ? 'default' : 'secondary'}>
                    {batch.status}
                  </Badge>
                  <span>{formatMicroUsd(batch.totalMicroUsdc)}</span>
                </div>
              </div>
            ))}
            {recentBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No batches yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-semibold tracking-normal">{value}</div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

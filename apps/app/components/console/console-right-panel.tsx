'use client';

import type { ReactNode } from 'react';

import { WorkflowLog } from '@/components/workflow-log';
import { useSendero, type ConsoleRightPanelMode } from '@/components/store';

export interface WorkspacePulseData {
  generatedAt: string;
  tripsUpdated: number;
  bookingsCreated: number;
  paidToolCalls: number;
  paidToolUsd: string;
  pendingHandoffs: number;
  channels: {
    slack: number;
    whatsapp: number;
  };
  topTools: Array<{
    name: string;
    calls: number;
    usd: string;
  }>;
}

export function ConsoleRightPanel({
  pulse,
  children,
}: {
  pulse: WorkspacePulseData;
  children?: ReactNode;
}) {
  const mode = useSendero(s => s.consoleRightPanelMode);

  if (mode === 'workflow') {
    return <WorkflowLog />;
  }

  if (mode === 'pulse') {
    return <WorkspacePulse pulse={pulse} />;
  }

  return children ? <>{children}</> : <div data-console-panel-hidden="true" />;
}

function WorkspacePulse({ pulse }: { pulse: WorkspacePulseData }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="col-head">
        <span className="title">Workspace pulse</span>
        <span className="tag faint">last 24h</span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <PulseMetric label="Trips" value={pulse.tripsUpdated} />
          <PulseMetric label="Bookings" value={pulse.bookingsCreated} />
          <PulseMetric label="Tool calls" value={pulse.paidToolCalls} />
          <PulseMetric label="Usage" value={`$${pulse.paidToolUsd}`} />
        </div>

        <section className="rounded border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-base)] p-3">
          <div className="t-meta">Support queue</div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <span className="t-num-md text-2xl">{pulse.pendingHandoffs}</span>
            <span className="t-mono text-[11px] text-[color:var(--text-dim)]">
              pending handoff{pulse.pendingHandoffs === 1 ? '' : 's'}
            </span>
          </div>
        </section>

        <section className="rounded border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-base)] p-3">
          <div className="t-meta">Channels</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ChannelPill label="Slack" value={pulse.channels.slack} />
            <ChannelPill label="WhatsApp" value={pulse.channels.whatsapp} />
          </div>
        </section>

        <section className="rounded border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-base)] p-3">
          <div className="t-meta">Top metered tools</div>
          <div className="mt-2 flex flex-col divide-y divide-[color:var(--hairline-color-soft)]">
            {pulse.topTools.length > 0 ? (
              pulse.topTools.map(tool => (
                <div key={tool.name} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-[color:var(--ink)]">
                      {tool.name}
                    </div>
                    <div className="font-mono text-[10px] text-[color:var(--text-dim)]">
                      {tool.calls} call{tool.calls === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-[color:var(--usdc)]">
                    ${tool.usd}
                  </span>
                </div>
              ))
            ) : (
              <div className="py-6 text-center font-mono text-[11px] text-[color:var(--text-faint)]">
                No paid tool calls in this window.
              </div>
            )}
          </div>
        </section>

        <div className="font-mono text-[10px] text-[color:var(--text-faint)]">
          Updated {new Date(pulse.generatedAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function PulseMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-base)] p-3">
      <div className="t-num-md text-2xl">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="t-meta mt-1">{label}</div>
    </div>
  );
}

function ChannelPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded border border-[color:var(--hairline-color-soft)] px-2 py-1 font-mono text-[11px]">
      <span>{label}</span>
      <strong className="text-[color:var(--ink)]">{value}</strong>
    </span>
  );
}

'use client';

/**
 * WorkflowLog — live stream of the last search/hold/pay pipeline.
 * Reads useSendero().workflow and groups events by `group`.
 */

import { useEffect, useMemo, useState } from 'react';

import { useSendero } from './store';
import { useMeterStream, useMeterSummary } from './use-meter';
import { WorkflowGraph } from './workflow-graph';
import { DigitTicker, SmoothNumber } from './footer-numbers';

interface Runtime {
  provider: string | null;
  model: string | null;
  toolCount: number;
}

export function WorkflowLog() {
  const workflow = useSendero(s => s.workflow);
  const treasury = useSendero(s => s.treasury);

  // Stable per-mount run id so the header doesn't flicker every render.
  const runId = useMemo(() => `wf_${Math.random().toString(36).slice(2, 10)}`, []);

  const [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    fetch('/api/agent/runtime', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => j && setRuntime(j))
      .catch(() => {});
  }, []);

  const { events: meterEvents, connected: meterConnected } = useMeterStream(30);
  const { summary: meterSummary } = useMeterSummary(1500);

  // Group events by `group` name, preserving order.
  const grouped = workflow.reduce<Record<string, typeof workflow>>((acc, evt) => {
    const bucket = acc[evt.group] ?? [];
    bucket.push(evt);
    acc[evt.group] = bucket;
    return acc;
  }, {});

  const modelLabel = runtime?.model ? `${runtime.provider}:${runtime.model}` : '—';
  const toolLabel = runtime ? `${runtime.toolCount} bound` : '—';

  return (
    <div className="col">
      <div className="col-head">
        <span className="title">Workflow</span>
        <span className="tag faint mono">▣ run · stream</span>
      </div>
      <div className="col-body log">
        <WorkflowGraph workflow={workflow} />

        <div
          style={{
            padding: '12px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          <Row k="run_id" v={runId} vColor="var(--ink)" />
          <Row k="model" v={modelLabel} />
          <Row k="tools" v={toolLabel} />
          <Row k="chain" v={`Arc L2 · ${treasury?.arc?.chainId ?? '—'}`} />
          <Row
            k="block"
            v={
              treasury?.arc?.blockNumber ? (
                <>
                  #<DigitTicker value={treasury.arc.blockNumber} />
                </>
              ) : (
                '#—'
              )
            }
          />
        </div>

        {Object.keys(grouped).length === 0 && (
          <div
            style={{
              padding: '24px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-faint)',
              lineHeight: 1.6,
            }}
          >
            {'// no runs yet.'}
            <br />
            {'// ask the agent or run a search to start.'}
          </div>
        )}

        {Object.entries(grouped).map(([group, events]) => (
          <div key={group} className="log-group">
            <div className="log-head">
              <span className="name">▸ {group}</span>
              <span className="dur">{events.length} evt</span>
            </div>
            {events.map(e => (
              <div key={e.id} className={`log-event ${e.bullet}`}>
                <span className="bullet">
                  {e.bullet === 'done'
                    ? '●'
                    : e.bullet === 'active'
                      ? '◉'
                      : e.bullet === 'fail'
                        ? '✕'
                        : '○'}
                </span>
                <span className="txt" dangerouslySetInnerHTML={{ __html: e.text }} />
                <span className="t">{e.t}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="log-group">
          <div
            className="log-head"
            title="USDC is Arc's native gas token. Per-call charges are paid in nano-USDC (1 nUSDC = 1e-9 USDC)."
          >
            <span className="name">▸ gas · nanopayments · arc</span>
            <span className="dur">
              {meterSummary
                ? `${meterSummary.paidCalls}p / ${meterSummary.rejectedCalls}r`
                : meterConnected
                  ? 'live'
                  : 'offline'}
            </span>
          </div>

          <div
            style={{
              padding: '4px 14px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-dim)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 2,
            }}
          >
            <span title="Total USDC paid as Arc gas (nUSDC = nano-USDC)">arc paid (nUSDC)</span>
            <span
              style={{
                color: 'var(--usdc)',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {meterSummary ? (
                <SmoothNumber
                  value={Number(meterSummary.totalUsdc) || 0}
                  precision={6}
                  suffix=" USDC"
                  cadence="fast"
                />
              ) : (
                '—'
              )}
            </span>
            <span>ethereum (est)</span>
            <span
              style={{
                color: 'var(--accent-rose)',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {meterSummary ? (
                <SmoothNumber
                  value={Number(meterSummary.ethereum.totalUsd) || 0}
                  precision={2}
                  prefix="$"
                  cadence="calm"
                />
              ) : (
                '—'
              )}
            </span>
            <span>margin delta</span>
            <span
              style={{
                color:
                  meterSummary && meterSummary.ethereum.marginFactor > 0
                    ? 'var(--accent-green)'
                    : 'var(--text-faint)',
                textAlign: 'right',
                fontWeight: 500,
              }}
            >
              {meterSummary && meterSummary.ethereum.marginFactor > 0 ? (
                <SmoothNumber
                  value={Number(meterSummary.ethereum.marginFactor) || 0}
                  precision={1}
                  suffix="×"
                  cadence="calm"
                />
              ) : (
                '—'
              )}
            </span>
          </div>

          {meterEvents.slice(-12).map(e => {
            const bullet =
              e.status === 'paid' ? 'done' : e.status === 'rejected' ? 'fail' : 'pending';
            return (
              <div key={`${e.at}-${e.toolName}-${e.status}`} className={`log-event ${bullet}`}>
                <span className="bullet">
                  {e.status === 'paid' ? '●' : e.status === 'rejected' ? '○' : '◌'}
                </span>
                <span className="txt">
                  <span style={{ color: 'var(--ink)' }}>{e.toolName}</span>
                  <span style={{ color: 'var(--text-faint)' }}>
                    {' · '}${e.priceUsdc}
                    {e.status === 'rejected' && e.note ? ` · ${e.note}` : ''}
                  </span>
                </span>
                <span className="t">{new Date(e.at).toTimeString().slice(0, 8)}</span>
              </div>
            );
          })}

          {meterEvents.length === 0 && (
            <div
              style={{
                padding: '8px 14px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-faint)',
              }}
            >
              {meterConnected
                ? '// waiting for first metered call…'
                : '// edge worker unreachable. run `bun apps/edge/src/index.ts`.'}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '16px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-faint)',
            lineHeight: 1.6,
          }}
        >
          <div>{'// powered by Circle Nanopayments + Arc L2'}</div>
          <div>{'// x402 batched settlement · duffel hold-then-pay'}</div>
          <div>{'// ─────────────────────────────'}</div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        color: 'var(--text-dim)',
        marginTop: 3,
      }}
    >
      <span>{k}</span>
      <span style={{ color: vColor ?? 'var(--text)' }}>{v}</span>
    </div>
  );
}

'use client';

/**
 * WorkflowLog — live stream of the last search/hold/pay pipeline.
 * Reads usePasillo().workflow and groups events by `group`.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePasillo } from './store';

interface Runtime {
  provider: string | null;
  model: string | null;
  toolCount: number;
}

export function WorkflowLog() {
  const workflow = usePasillo((s) => s.workflow);
  const treasury = usePasillo((s) => s.treasury);

  // Stable per-mount run id so the header doesn't flicker every render.
  const runId = useMemo(
    () => `wf_${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  const [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    fetch('/api/agent/runtime', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setRuntime(j))
      .catch(() => {});
  }, []);

  // Group events by `group` name, preserving order.
  const grouped = workflow.reduce<Record<string, typeof workflow>>(
    (acc, evt) => {
      (acc[evt.group] ||= []).push(evt);
      return acc;
    },
    {},
  );

  const modelLabel = runtime?.model
    ? `${runtime.provider}:${runtime.model}`
    : '—';
  const toolLabel = runtime ? `${runtime.toolCount} bound` : '—';

  return (
    <div className="col sunk">
      <div className="col-head">
        <span className="title">Workflow</span>
        <span className="tag faint mono">▣ run · stream</span>
      </div>
      <div className="col-body log">
        <div
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          <Row k="run_id" v={runId} vColor="var(--ink)" />
          <Row k="model" v={modelLabel} />
          <Row k="tools" v={toolLabel} />
          <Row k="chain" v={`Arc L2 · ${treasury?.arc?.chainId ?? '—'}`} />
          <Row k="block" v={`#${treasury?.arc?.blockNumber ?? '—'}`} />
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
            {events.map((e) => (
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
                <span
                  className="txt"
                  dangerouslySetInnerHTML={{ __html: e.text }}
                />
                <span className="t">{e.t}</span>
              </div>
            ))}
          </div>
        ))}

        <div
          style={{
            padding: '16px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-faint)',
            lineHeight: 1.6,
          }}
        >
          <div>{'// powered by Circle CCTP v2 + Arc L2'}</div>
          <div>{'// duffel hold-then-pay · balance settlement'}</div>
          <div>{'// ─────────────────────────────'}</div>
        </div>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
  vColor,
}: {
  k: string;
  v: string;
  vColor?: string;
}) {
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

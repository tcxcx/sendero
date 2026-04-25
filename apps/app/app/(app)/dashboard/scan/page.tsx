'use client';

/**
 * /dashboard/scan — interactive Gemini-backed document extractor.
 *
 * Surface mirrors `route-artboards.jsx::ScanA`: a primary dotgrid
 * drop zone (left, 2fr) plus a stacked sidebar (right, 1fr) with
 * "Recently scanned" + "What we extract" cards. The drop zone morphs
 * through idle / uploading / extracting / done / error.
 *
 * Pipeline is unchanged: file → multipart POST /api/scan → @sendero/ocr
 * → Gemini 2.5 Flash with a Zod-bound structured output → typed object
 * back. Latency is shown on the result row so the user always sees
 * ground truth.
 */

import { useRef, useState } from 'react';

import { Crumb } from '@/components/console/crumb';

type DocKind = 'receipt' | 'invoice' | 'boarding_pass';

type ScanResponse =
  | {
      kind: DocKind;
      provider: 'gateway' | 'vertex' | 'google';
      model: string;
      latencyMs: number;
      data: Record<string, unknown>;
    }
  | { error: string; message?: string };

const KIND_LABEL: Record<DocKind, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  boarding_pass: 'Boarding pass',
};

const DEMO_HINTS: Record<DocKind, string> = {
  receipt: 'Coffee-shop paper receipt, hotel folio, grocery till roll, Uber e-receipt.',
  invoice: 'Supplier bill, SaaS invoice PDF, contractor invoice.',
  boarding_pass: 'Airline mobile boarding pass PDF or screenshot. IATA codes, PNR, gate.',
};

interface RecentScan {
  id: string;
  name: string;
  at: number;
  kind: DocKind;
  state: string;
  tone: 'sea' | 'outline';
}

const EXTRACTS = [
  'Carrier, flight number, PNR',
  'Routing, dates, fare class',
  'Hotel folio totals, taxes',
  'Visa expiry, passport hash',
];

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ScanPage() {
  const [kind, setKind] = useState<DocKind>('receipt');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'extracting' | 'done' | 'error'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentScan[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setError(null);
    setResult(null);
    setStatus('uploading');

    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);

    try {
      setStatus('extracting');
      const t0 = performance.now();
      const res = await fetch('/api/scan', { method: 'POST', body: form });
      const wallMs = Math.round(performance.now() - t0);
      const json = (await res.json()) as ScanResponse;
      if (!res.ok || 'error' in json) {
        const msg =
          'message' in json ? json.message : 'error' in json ? json.error : 'Unknown error';
        setError(String(msg));
        setStatus('error');
        return;
      }
      setResult({ ...json, latencyMs: json.latencyMs ?? wallMs });
      setStatus('done');
      setRecents(prev =>
        [
          {
            id: `scan_${Date.now().toString(36)}`,
            name: file.name,
            at: Date.now(),
            kind,
            state: `${KIND_LABEL[kind]} extracted`,
            tone: 'sea' as const,
          },
          ...prev,
        ].slice(0, 8)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void onFile(file);
  };

  const reset = () => {
    setStatus('idle');
    setError(null);
    setResult(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const isBusy = status === 'uploading' || status === 'extracting';

  return (
    <div
      style={{
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Crumb trail={['Workspace', 'Scan document']} />

      <header>
        <h1 className="t-h1">Scan a document</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Drop an itinerary, invoice, or visa scan. We&rsquo;ll extract structured fields and route
          it to the right trip.
        </p>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="t-meta">Document kind</span>
        {(Object.keys(KIND_LABEL) as DocKind[]).map(k => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                reset();
              }}
              className="sd-pill"
              style={{
                cursor: 'pointer',
                border: 0,
                padding: '5px 12px',
                fontSize: 11,
                fontFamily: 'var(--font-mono-x)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: active ? 'var(--vermillion)' : 'var(--surface-floating)',
                color: active ? '#fdfbf7' : 'var(--midnight)',
                boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--hairline-color)',
              }}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
        <span className="t-body ink-60" style={{ fontSize: 12 }}>
          · {DEMO_HINTS[kind]}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 24,
          minHeight: 0,
        }}
      >
        {/* LEFT — drop zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => {
            if (status === 'idle') inputRef.current?.click();
          }}
          style={{
            background: 'var(--surface-base)',
            backgroundImage: isBusy
              ? 'radial-gradient(circle, rgba(214,84,56,0.22) 1px, transparent 1px)'
              : 'radial-gradient(circle, rgba(31,42,68,0.18) 1px, transparent 1px)',
            backgroundSize: '8px 8px',
            borderRadius: 'var(--radius-xl)',
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            textAlign: 'center',
            boxShadow: isBusy
              ? 'inset 0 0 0 1.5px var(--vermillion)'
              : 'inset 0 0 0 1px var(--hairline-color)',
            cursor: status === 'idle' ? 'pointer' : 'default',
            transition: 'box-shadow 120ms ease',
            minHeight: 320,
          }}
        >
          {status === 'idle' && <DropZoneIdle onChooseFile={() => inputRef.current?.click()} />}
          {(status === 'uploading' || status === 'extracting') && (
            <DropZoneBusy status={status} fileName={fileName} />
          )}
          {status === 'error' && (
            <DropZoneError message={error ?? 'Unknown error'} onRetry={reset} />
          )}
          {status === 'done' && result && !('error' in result) && (
            <DropZoneDone result={result} fileName={fileName} onReset={reset} />
          )}

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </div>

        {/* RIGHT — recently scanned + what we extract */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="t-meta">Recently scanned</span>
              <span style={{ flex: 1 }} />
              <span className="t-mono ink-60" style={{ fontSize: 10 }}>
                this session
              </span>
            </div>
            {recents.length === 0 ? (
              <div
                className="t-body ink-60"
                style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.55 }}
              >
                Drop a document on the left to start. Scans you run on this page show up here until
                you reload.
              </div>
            ) : (
              <div
                style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
                role="list"
              >
                {recents.map(s => (
                  <div
                    key={s.id}
                    role="listitem"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="t-body"
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.name}
                      </div>
                      <div className="t-mono ink-60" style={{ fontSize: 11, marginTop: 2 }}>
                        {formatAge(Date.now() - s.at)}
                      </div>
                    </div>
                    <span
                      className={`sd-pill sd-pill-${s.tone}`}
                      style={{ fontSize: 9, padding: '2px 7px', flexShrink: 0 }}
                    >
                      {s.state}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">What we extract</div>
            <ul
              className="t-body ink-70"
              style={{
                margin: '10px 0 0',
                paddingLeft: 18,
                lineHeight: 1.7,
                fontSize: 13,
              }}
            >
              {EXTRACTS.map(e => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── drop-zone states ──────────────────────────────────────────

function BinocularMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(31,42,68,0.45)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6.5" cy="14" r="3.5" />
      <circle cx="17.5" cy="14" r="3.5" />
      <path d="M10 14 L14 14" />
      <path d="M5 10 L8 4 L11 10" />
      <path d="M13 10 L16 4 L19 10" />
    </svg>
  );
}

function DropZoneIdle({ onChooseFile }: { onChooseFile: () => void }) {
  return (
    <>
      <BinocularMark size={56} />
      <div className="t-h2">Drop the document anywhere here</div>
      <div className="t-body-lg ink-70" style={{ maxWidth: '40ch' }}>
        PDF, JPEG, PNG, HEIC, WebP up to 20 MB. Or paste an emailed itinerary URL.
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onChooseFile();
          }}
          style={{
            padding: '8px 18px',
            background: 'var(--vermillion)',
            color: '#fdfbf7',
            border: 0,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-mono-x)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Choose file
        </button>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          disabled
          title="Coming soon"
          style={{
            padding: '8px 18px',
            background: 'transparent',
            color: 'var(--midnight)',
            border: 0,
            boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-mono-x)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'not-allowed',
            opacity: 0.55,
          }}
        >
          Paste URL
        </button>
      </div>
      <div className="t-meta ink-50" style={{ marginTop: 14 }}>
        Image bytes never leave your browser. We hash + extract locally.
      </div>
    </>
  );
}

function DropZoneBusy({
  status,
  fileName,
}: {
  status: 'uploading' | 'extracting';
  fileName: string | null;
}) {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          background: 'var(--vermillion)',
          boxShadow: '0 0 12px rgba(214,84,56,0.7)',
          animation: 'sd-pulse 1.2s ease-in-out infinite',
        }}
      />
      <div className="t-h3">
        {status === 'uploading' ? 'Uploading…' : 'Thinking with Gemini 2.5 Flash…'}
      </div>
      {fileName ? (
        <div className="t-mono ink-60" style={{ fontSize: 11 }}>
          {fileName}
        </div>
      ) : null}
      <style>{`@keyframes sd-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </>
  );
}

function DropZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <div
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: 'rgba(214,84,56,0.12)',
          color: 'var(--vermillion)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 22,
        }}
      >
        ✕
      </div>
      <div className="t-h3">Extraction failed</div>
      <div className="t-body ink-70" style={{ maxWidth: '50ch' }}>
        {message}
      </div>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onRetry();
        }}
        style={{
          padding: '8px 18px',
          background: 'var(--midnight)',
          color: '#fdfbf7',
          border: 0,
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono-x)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Try another file
      </button>
    </>
  );
}

function DropZoneDone({
  result,
  fileName,
  onReset,
}: {
  result: Extract<ScanResponse, { latencyMs: number }>;
  fileName: string | null;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span className="t-meta" style={{ color: 'var(--vermillion)' }}>
          Extracted in {result.latencyMs} ms
        </span>
        <span className="t-mono ink-60" style={{ fontSize: 10 }}>
          · {result.provider}:{result.model}
          {fileName ? ` · ${fileName}` : ''}
        </span>
      </div>
      <ExtractionTable data={result.data} />
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            color: 'var(--midnight)',
            border: 0,
            boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'var(--font-mono-x)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Scan another
        </button>
      </div>
    </div>
  );
}

function ExtractionTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) {
    return (
      <p className="t-body ink-60" style={{ fontSize: 13 }}>
        No fields extracted. The document may not match the selected kind.
      </p>
    );
  }
  return (
    <div
      className="sd-card-flat"
      style={{
        boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
        background: 'var(--surface-floating)',
        padding: '12px 14px',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: 'var(--font-mono-x)',
        fontSize: 12,
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      {entries.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, auto) 1fr',
            gap: 12,
            padding: '4px 0',
            borderTop: '1px solid var(--hairline-color-soft)',
            alignItems: 'baseline',
          }}
        >
          <span className="ink-60" style={{ fontSize: 11 }}>
            {k}
          </span>
          <span style={{ wordBreak: 'break-word', color: 'var(--midnight)' }}>
            {renderValue(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `${v.length} item${v.length === 1 ? '' : 's'} · ${v
      .slice(0, 3)
      .map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
      .join(' · ')}${v.length > 3 ? ' …' : ''}`;
  }
  return JSON.stringify(v, null, 2);
}

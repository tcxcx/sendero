'use client';

/**
 * /dashboard/passport — the traveler-facing vault surface.
 *
 * Three layout states, mirroring `route-artboards.jsx::PassportA/B`:
 *   - `on_file` → PassportA. 1.2fr/1fr grid: identity card + MRZ
 *      details + actions on the left, audit log + privacy note right.
 *   - `empty` / `error` / `uploading` → PassportB. 1.3fr/1fr grid:
 *      dotgrid drop zone + MRZ inputs left, "why we ask" right.
 *   - `loading` — terse status card.
 *
 * Wiring is unchanged from the previous surface:
 *   GET    /api/passport/self           → vault signals
 *   GET    /api/passport/self?reveal=1  → decrypted record (audit-logged)
 *   POST   /api/passport/upload         → MRZ + image SHA-256
 *   DELETE /api/passport/self           → revoke (tombstones ciphertext)
 *
 * Image bytes never leave the browser: `crypto.subtle.digest('SHA-256')`
 * runs against the file in `onFile`, and only the hex digest + the two
 * MRZ lines are sent to the server.  Server-side guards (MRZ checksum,
 * vault encrypt, access log) live in `@sendero/vault`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Crumb } from '@/components/console/crumb';

interface VaultSignals {
  vaultId: string;
  documentVariant: string;
  nationalityIso3: string | null;
  expiresOn: string | null;
  mrzChecksumValid: boolean;
  extractedBy: string;
  extractedAt: string;
}

type Status = 'loading' | 'empty' | 'extracting' | 'on_file' | 'uploading' | 'error';

interface TripSummary {
  id: string;
  status: string;
  destination: string | null;
  travelerLabel: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  text: string;
  at: number;
}

export default function PassportPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [vault, setVault] = useState<VaultSignals | null>(null);
  const [revealedExtraction, setRevealedExtraction] = useState<Record<string, unknown> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [mrzLine1, setMrzLine1] = useState('');
  const [mrzLine2, setMrzLine2] = useState('');
  const [extractionMeta, setExtractionMeta] = useState<{
    provider: string;
    model: string;
    latencyMs: number;
  } | null>(null);
  const [activeTrips, setActiveTrips] = useState<TripSummary[] | null>(null);
  const [localAudit, setLocalAudit] = useState<AuditEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVault = useCallback(async () => {
    console.log('[passport] → GET /api/passport/self');
    try {
      const res = await fetch('/api/passport/self', { cache: 'no-store' });
      console.log('[passport] ← /api/passport/self', { status: res.status, ok: res.ok });
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        vault?: VaultSignals | null;
      };
      if (!res.ok || body.error) {
        throw new Error(body.message ?? body.error ?? 'Failed to load vault state');
      }
      console.log('[passport] vault state', { hasVault: Boolean(body.vault) });
      setVault(body.vault ?? null);
      setStatus(body.vault ? 'on_file' : 'empty');
    } catch (err) {
      console.error('[passport] loadVault failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load vault state');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  const submit = useCallback(
    async (line1: string, line2: string, filename: string | null, imageSha256?: string) => {
      console.log('[passport] → POST /api/passport/upload', {
        mrz1Len: line1.length,
        mrz2Len: line2.length,
        filename,
        hasImageHash: Boolean(imageSha256),
      });
      setStatus('uploading');
      setError(null);
      try {
        const res = await fetch('/api/passport/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mrzLine1: line1.trim().toUpperCase(),
            mrzLine2: line2.trim().toUpperCase(),
            filename,
            imageSha256,
          }),
        });
        console.log('[passport] ← /api/passport/upload', { status: res.status, ok: res.ok });
        const body = (await safeJson(res)) as
          | { vaultId: string; [k: string]: unknown }
          | { error: string; message?: string };
        if (!res.ok || 'error' in body) {
          const msg =
            'message' in body ? body.message : 'error' in body ? body.error : 'Upload failed';
          setError(String(msg));
          setStatus('empty');
          return;
        }
        await loadVault();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        setStatus('empty');
      }
    },
    [loadVault]
  );

  const onFile = useCallback(
    async (file: File) => {
      console.log('[passport] file picked', {
        name: file.name,
        type: file.type,
        bytes: file.size,
      });
      setStatus('extracting');
      setError(null);
      setExtractionMeta(null);
      try {
        const form = new FormData();
        form.append('file', file);
        console.log('[passport] → POST /api/passport/extract-mrz');
        const tStart = Date.now();
        const res = await fetch('/api/passport/extract-mrz', { method: 'POST', body: form });
        console.log('[passport] ← /api/passport/extract-mrz', {
          status: res.status,
          ok: res.ok,
          wallClockMs: Date.now() - tStart,
        });
        const body = (await res.json().catch(() => ({}))) as {
          mrzLine1?: string;
          mrzLine2?: string;
          imageSha256?: string;
          provider?: string;
          model?: string;
          latencyMs?: number;
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.mrzLine1 || !body.mrzLine2 || !body.imageSha256) {
          console.warn('[passport] extract failed', {
            status: res.status,
            error: body.error,
            message: body.message,
          });
          setError(body.message ?? body.error ?? 'Could not read the MRZ from this image.');
          setStatus('empty');
          return;
        }
        console.log('[passport] extract ok', {
          provider: body.provider,
          model: body.model,
          latencyMs: body.latencyMs,
          mrz1Len: body.mrzLine1.length,
          mrz2Len: body.mrzLine2.length,
        });
        setMrzLine1(body.mrzLine1);
        setMrzLine2(body.mrzLine2);
        if (body.provider && body.model && typeof body.latencyMs === 'number') {
          setExtractionMeta({
            provider: body.provider,
            model: body.model,
            latencyMs: body.latencyMs,
          });
        }
        await submit(body.mrzLine1, body.mrzLine2, file.name, body.imageSha256);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error during extraction');
        setStatus('empty');
      }
    },
    [submit]
  );

  const revokeVault = useCallback(async () => {
    if (
      !confirm(
        'Revoke your passport record? The ciphertext is tombstoned and cannot be decrypted again.'
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/passport/self', { method: 'DELETE' });
      if (!res.ok) throw new Error('Revoke failed');
      setVault(null);
      setRevealedExtraction(null);
      setLocalAudit([]);
      setStatus('empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  }, []);

  // Once the vault is on file, fetch open trips so the user can see
  // where the passport will be used. Empty list → CTA to /dashboard/trips.
  useEffect(() => {
    if (status !== 'on_file') return;
    let cancelled = false;
    void (async () => {
      console.log('[passport] → GET /api/passport/active-trips');
      try {
        const res = await fetch('/api/passport/active-trips', { cache: 'no-store' });
        console.log('[passport] ← /api/passport/active-trips', {
          status: res.status,
          ok: res.ok,
        });
        const body = (await res.json().catch(() => ({}))) as { trips?: TripSummary[] };
        console.log('[passport] active trips', { count: body.trips?.length ?? 0 });
        if (!cancelled) setActiveTrips(body.trips ?? []);
      } catch (err) {
        console.error('[passport] active-trips fetch failed', err);
        if (!cancelled) setActiveTrips([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, vault?.vaultId]);

  const reveal = useCallback(async () => {
    try {
      const res = await fetch('/api/passport/self?reveal=1', { cache: 'no-store' });
      const body = (await res.json()) as {
        vault: VaultSignals | null;
        payload: { extraction: Record<string, unknown> } | null;
      };
      setRevealedExtraction(body.payload?.extraction ?? null);
      setLocalAudit(prev =>
        [
          { id: `reveal_${Date.now().toString(36)}`, text: 'Revealed by you', at: Date.now() },
          ...prev,
        ].slice(0, 12)
      );
    } catch {
      setError('Could not decrypt your vault record.');
    }
  }, []);

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
      <Crumb trail={['Passport']} />

      {status === 'on_file' && vault ? (
        <>
          <PassportOnFile
            vault={vault}
            revealedExtraction={revealedExtraction}
            localAudit={localAudit}
            onReveal={reveal}
            onHide={() => setRevealedExtraction(null)}
            onReplace={() => {
              setStatus('empty');
              setError(null);
            }}
            onRevoke={revokeVault}
          />
          <PassportTripAssignment trips={activeTrips} />
        </>
      ) : null}

      {(status === 'empty' ||
        status === 'extracting' ||
        status === 'uploading' ||
        status === 'error') && (
        <PassportUpload
          status={status}
          error={error}
          extractionMeta={extractionMeta}
          mrzLine1={mrzLine1}
          mrzLine2={mrzLine2}
          fileInputRef={fileInputRef}
          onMrz1={setMrzLine1}
          onMrz2={setMrzLine2}
          onChooseImage={() => fileInputRef.current?.click()}
          onSubmit={() => {
            if (!mrzLine1.trim() || !mrzLine2.trim()) return;
            void submit(mrzLine1, mrzLine2, null);
          }}
          onFile={onFile}
        />
      )}

      {status === 'loading' ? (
        <div
          className="sd-card-flat"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
        >
          <span className="t-mono ink-60" style={{ fontSize: 11 }}>
            Loading vault state…
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── on-file (PassportA) ───────────────────────────────────────

function PassportOnFile({
  vault,
  revealedExtraction,
  localAudit,
  onReveal,
  onHide,
  onReplace,
  onRevoke,
}: {
  vault: VaultSignals;
  revealedExtraction: Record<string, unknown> | null;
  localAudit: AuditEntry[];
  onReveal: () => void;
  onHide: () => void;
  onReplace: () => void;
  onRevoke: () => void;
}) {
  const expiresLabel = vault.expiresOn
    ? `${vault.expiresOn} · ${expiresIn(vault.expiresOn)}`
    : 'unknown';
  const sealedAt = new Date(vault.extractedAt);
  const vaultKey = `${vault.vaultId.slice(0, 10)}…${vault.vaultId.slice(-3)} · per-tenant`;

  return (
    <>
      <header>
        <h1 className="t-h1">Passport on file</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Extracted {timeAgo(vault.extractedAt)} via {vault.extractedBy.replace(/_/g, ' ')}. Image
          bytes never left your browser.
        </p>
      </header>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 20,
          minHeight: 0,
        }}
      >
        {/* LEFT — identity + MRZ details + actions */}
        <div
          className="sd-card-raised"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                aria-hidden
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: vault.mrzChecksumValid
                    ? 'rgba(46,168,118,0.12)'
                    : 'rgba(214,84,56,0.12)',
                  color: vault.mrzChecksumValid ? '#2EA876' : 'var(--vermillion)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 22,
                }}
              >
                {vault.mrzChecksumValid ? '✓' : '!'}
              </div>
              <div>
                <div className="t-h3">
                  {vault.nationalityIso3 ?? 'Unknown'} · {vault.documentVariant}
                </div>
                <div className="t-body ink-60" style={{ fontSize: 13 }}>
                  Expires {vault.expiresOn ?? 'unknown'}
                </div>
              </div>
            </div>
            <span
              className={`sd-pill sd-pill-${vault.mrzChecksumValid ? 'sea' : 'verm'}`}
              style={{ fontSize: 9, padding: '3px 8px', fontWeight: 700 }}
            >
              {vault.mrzChecksumValid ? 'MRZ VALIDATED' : 'MRZ CHECK FAILED'}
            </span>
          </div>

          <hr
            aria-hidden
            style={{
              border: 0,
              height: 1,
              background: 'var(--hairline-color-soft)',
              margin: 0,
            }}
          />

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              rowGap: 10,
              columnGap: 24,
              margin: 0,
            }}
          >
            <dt className="t-meta">Nationality</dt>
            <dd className="t-mono" style={{ margin: 0, fontSize: 12 }}>
              {vault.nationalityIso3 ?? 'unknown'}
            </dd>
            <dt className="t-meta">Document</dt>
            <dd className="t-mono" style={{ margin: 0, fontSize: 12 }}>
              {vault.documentVariant}
            </dd>
            <dt className="t-meta">Expires</dt>
            <dd className="t-mono" style={{ margin: 0, fontSize: 12 }}>
              {expiresLabel}
            </dd>
            <dt className="t-meta">Sealed</dt>
            <dd className="t-mono" style={{ margin: 0, fontSize: 12 }}>
              {sealedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
            </dd>
            <dt className="t-meta">Vault key</dt>
            <dd className="t-mono" style={{ margin: 0, fontSize: 12 }}>
              {vaultKey}
            </dd>
          </dl>

          {revealedExtraction ? (
            <div
              className="sd-card-flat"
              style={{
                boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
                background: 'var(--surface-floating)',
                padding: '12px 14px',
              }}
            >
              <div className="t-meta" style={{ marginBottom: 6 }}>
                Decrypted view · auditable
              </div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-mono-x)',
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--midnight)',
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(revealedExtraction, null, 2)}
              </pre>
            </div>
          ) : null}

          <hr
            aria-hidden
            style={{
              border: 0,
              height: 1,
              background: 'var(--hairline-color-soft)',
              margin: 0,
            }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={revealedExtraction ? onHide : onReveal}
              className="sd-pill sd-pill-outline"
              style={ghostBtnStyle}
            >
              {revealedExtraction ? '👁  Hide' : '👁  Reveal record'}
            </button>
            <button
              type="button"
              onClick={onReplace}
              className="sd-pill sd-pill-outline"
              style={ghostBtnStyle}
            >
              ↑ Replace
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onRevoke}
              className="sd-pill sd-pill-outline"
              style={{ ...ghostBtnStyle, color: 'var(--vermillion)' }}
            >
              Revoke
            </button>
          </div>
        </div>

        {/* RIGHT — audit log + privacy note */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">Audit log</div>
            <div className="t-body ink-70" style={{ marginTop: 10, lineHeight: 1.8, fontSize: 13 }}>
              {localAudit.map(entry => (
                <div key={entry.id}>
                  {timeAgo(new Date(entry.at).toISOString())} · {entry.text}
                </div>
              ))}
              <div>
                {timeAgo(vault.extractedAt)} · sealed · MRZ checksum{' '}
                {vault.mrzChecksumValid ? '✓' : '✕'}
              </div>
              <div>
                {timeAgo(vault.extractedAt)} · uploaded · vault {vault.vaultId.slice(0, 10)}…
              </div>
            </div>
          </div>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">How this stays private</div>
            <p className="t-body ink-70" style={{ marginTop: 8, lineHeight: 1.6, fontSize: 13 }}>
              Only the two MRZ lines + a SHA-256 of the source image leave your browser. Server-side
              encryption uses a per-tenant key derived inside <code>@sendero/vault</code>. Every
              reveal is logged with operator + timestamp.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── post-save trip assignment ─────────────────────────────────
//
// After the vault is on file, surface where the passport will be
// used. Empty trip list → redirect CTA to /dashboard/trips so the
// user can create one. Non-empty → list up to six open trips with
// "Apply to trip" links. The link itself doesn't write a relation
// (PassportVault is per-User, not per-Trip — it's discovered by the
// agent at eligibility-check time); it just navigates to the trip
// detail page where the traveler/passport binding becomes visible.

function PassportTripAssignment({ trips }: { trips: TripSummary[] | null }) {
  if (trips === null) {
    return (
      <div
        className="sd-card-flat"
        style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
      >
        <span className="t-mono ink-60" style={{ fontSize: 11 }}>
          Loading trips…
        </span>
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div
        className="sd-card-raised"
        style={{
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div className="t-meta">Use this passport</div>
        <div className="t-h3">No open trips yet</div>
        <p className="t-body ink-70" style={{ margin: 0, fontSize: 13, maxWidth: '52ch' }}>
          Your passport is sealed and ready. Create a trip to attach it to a traveler — the agent
          uses your vault automatically at eligibility-check time.
        </p>
        <div>
          <a href="/dashboard/trips" style={{ ...primaryBtnStyle, textDecoration: 'none' }}>
            Create a trip →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="sd-card-raised"
      style={{
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div className="t-meta">Use this passport</div>
          <div className="t-h3" style={{ marginTop: 4 }}>
            Apply to a trip
          </div>
        </div>
        <a
          href="/dashboard/trips"
          className="t-mono ink-60"
          style={{ fontSize: 11, textDecoration: 'underline' }}
        >
          All trips →
        </a>
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {trips.map(trip => (
          <li
            key={trip.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--surface-base)',
              boxShadow: 'inset 0 0 0 1px var(--hairline-color-soft)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div className="t-body" style={{ fontSize: 13, fontWeight: 500 }}>
                {trip.destination ?? `Trip ${trip.id.slice(0, 8)}`}
              </div>
              <div className="t-mono ink-60" style={{ fontSize: 11 }}>
                {trip.travelerLabel ?? 'unassigned traveler'} · {trip.status}
              </div>
            </div>
            <a
              href={`/dashboard/trips/${trip.id}`}
              style={{
                ...ghostBtnStyle,
                padding: '6px 12px',
                fontSize: 11,
                textDecoration: 'none',
              }}
            >
              Apply →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── upload (PassportB) ────────────────────────────────────────

function PassportUpload({
  status,
  error,
  extractionMeta,
  mrzLine1,
  mrzLine2,
  fileInputRef,
  onMrz1,
  onMrz2,
  onChooseImage,
  onSubmit,
  onFile,
}: {
  status: Status;
  error: string | null;
  extractionMeta: { provider: string; model: string; latencyMs: number } | null;
  mrzLine1: string;
  mrzLine2: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onMrz1: (v: string) => void;
  onMrz2: (v: string) => void;
  onChooseImage: () => void;
  onSubmit: () => void;
  onFile: (file: File) => Promise<void>;
}) {
  const extracting = status === 'extracting';
  const uploading = status === 'uploading';
  const busy = extracting || uploading;
  return (
    <>
      <header>
        <h1 className="t-h1">Add your passport</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Drop a photo of the photo page. We extract the MRZ on the server, encrypt it with a
          per-tenant key, and discard the image. Only the two MRZ lines are persisted.
        </p>
      </header>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 20,
          minHeight: 0,
        }}
      >
        {/* LEFT — drop zone + MRZ inputs */}
        <div
          className="sd-card-flat"
          style={{
            boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={async e => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) await onFile(file);
            }}
            style={{
              background: 'var(--surface-base)',
              backgroundImage: busy
                ? 'radial-gradient(circle, rgba(214,84,56,0.22) 1px, transparent 1px)'
                : 'radial-gradient(circle, rgba(31,42,68,0.18) 1px, transparent 1px)',
              backgroundSize: '8px 8px',
              padding: '56px 32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              textAlign: 'center',
              minHeight: 240,
              boxShadow: busy ? 'inset 0 0 0 1.5px var(--vermillion)' : 'none',
              transition: 'box-shadow 120ms ease',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                background: 'var(--tint-vermillion-soft)',
                color: 'var(--vermillion)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 22,
              }}
            >
              🔒
            </div>
            <div className="t-h2">
              {extracting ? 'Reading MRZ…' : uploading ? 'Encrypting…' : 'Drop your passport image'}
            </div>
            <div className="t-body ink-70" style={{ fontSize: 13 }}>
              {extracting
                ? 'Vision model is transcribing the two machine-readable lines.'
                : 'Drag in a JPEG, PNG, or HEIC of the photo page — or pick a file.'}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={onChooseImage}
                disabled={busy}
                style={{
                  ...primaryBtnStyle,
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {extracting ? 'Reading…' : uploading ? 'Encrypting…' : 'Choose image'}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
          </div>

          {error ? (
            <div
              style={{
                padding: '12px 28px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <p className="t-mono" style={{ color: 'var(--vermillion)', fontSize: 11, margin: 0 }}>
                {error}
              </p>
            </div>
          ) : null}

          {extractionMeta && busy ? (
            <div
              style={{
                padding: '12px 28px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div className="t-meta">
                Read by {extractionMeta.provider}/{extractionMeta.model} ·{' '}
                {extractionMeta.latencyMs}ms
              </div>
            </div>
          ) : null}

          <details
            style={{
              padding: '20px 28px 24px',
              borderTop: '1px solid var(--hairline-color-soft)',
              marginTop: 12,
            }}
          >
            <summary
              className="t-meta"
              style={{ cursor: 'pointer', userSelect: 'none', listStyle: 'none' }}
            >
              ▸ Paste MRZ manually (fallback)
            </summary>
            <form
              onSubmit={e => {
                e.preventDefault();
                onSubmit();
              }}
              style={{
                marginTop: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="t-meta">MRZ line 1 · 44 characters</span>
                <input
                  value={mrzLine1}
                  onChange={e => onMrz1(e.target.value)}
                  maxLength={50}
                  placeholder="P<USASMITH<<JOHN<MICHAEL<<<<<<<<<<<<<<<<<<<<"
                  disabled={busy}
                  className="t-mono"
                  style={mrzInputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="t-meta">MRZ line 2 · 44 characters</span>
                <input
                  value={mrzLine2}
                  onChange={e => onMrz2(e.target.value)}
                  maxLength={50}
                  placeholder="L898902C36USA7408122M1204159ZE184226B<<<<<10"
                  disabled={busy}
                  className="t-mono"
                  style={mrzInputStyle}
                />
              </label>
              <div>
                <button
                  type="submit"
                  disabled={!mrzLine1.trim() || !mrzLine2.trim() || busy}
                  style={{
                    ...primaryBtnStyle,
                    alignSelf: 'flex-start',
                    opacity: !mrzLine1.trim() || !mrzLine2.trim() || busy ? 0.5 : 1,
                    cursor:
                      !mrzLine1.trim() || !mrzLine2.trim() || busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busy ? 'Encrypting…' : 'Save encrypted'}
                </button>
              </div>
            </form>
          </details>
        </div>

        {/* RIGHT — privacy explainers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">Why we ask</div>
            <p className="t-body ink-70" style={{ marginTop: 8, lineHeight: 1.6, fontSize: 13 }}>
              Sendero books on your behalf. Carriers and hotels need passport data on file. We store
              it encrypted and reveal it only to you.
            </p>
          </div>
          <div
            className="sd-card-flat"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline-color)', padding: '14px 16px' }}
          >
            <div className="t-meta">Three guarantees</div>
            <ol
              className="t-body ink-70"
              style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.8, fontSize: 13 }}
            >
              <li>Image bytes never leave the browser.</li>
              <li>Per-tenant encryption key.</li>
              <li>Every reveal is audit-logged.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}

// ── styles + helpers ──────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
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
};

const ghostBtnStyle: React.CSSProperties = {
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
};

const mrzInputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--surface-floating)',
  borderRadius: 8,
  border: 0,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color-soft)',
  color: 'var(--midnight)',
  fontSize: 12,
  fontFamily: 'var(--font-mono-x)',
  outline: 'none',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function expiresIn(isoDate: string): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const remainder = months - years * 12;
  return remainder > 0 ? `${years}y ${remainder}m` : `${years}y`;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return { error: 'invalid_response', message: res.statusText || 'Request failed' };
  }
}

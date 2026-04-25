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

type Status = 'loading' | 'empty' | 'on_file' | 'uploading' | 'error';

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
  const [tesseractBusy, setTesseractBusy] = useState(false);
  const [localAudit, setLocalAudit] = useState<AuditEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVault = useCallback(async () => {
    try {
      const res = await fetch('/api/passport/self', { cache: 'no-store' });
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        vault?: VaultSignals | null;
      };
      if (!res.ok || body.error) {
        throw new Error(body.message ?? body.error ?? 'Failed to load vault state');
      }
      setVault(body.vault);
      setStatus(body.vault ? 'on_file' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vault state');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  const submit = useCallback(
    async (line1: string, line2: string, filename: string | null, imageSha256?: string) => {
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
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      if (mrzLine1.trim() && mrzLine2.trim()) {
        await submit(mrzLine1, mrzLine2, file.name, hex);
      } else {
        setError('Saved the image hash. Paste both MRZ lines below, then Submit.');
      }
    },
    [mrzLine1, mrzLine2, submit]
  );

  const onTesseract = useCallback(async () => {
    setTesseractBusy(true);
    setError(
      'Tesseract-based auto-extraction is stubbed — paste both MRZ lines manually for now. Client-side MRZ OCR lands in a follow-up PR.'
    );
    setTesseractBusy(false);
  }, []);

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
      <Crumb trail={['Workspace', 'Passport']} />

      {status === 'on_file' && vault ? (
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
      ) : null}

      {(status === 'empty' || status === 'uploading' || status === 'error') && (
        <PassportUpload
          status={status}
          error={error}
          mrzLine1={mrzLine1}
          mrzLine2={mrzLine2}
          tesseractBusy={tesseractBusy}
          fileInputRef={fileInputRef}
          onMrz1={setMrzLine1}
          onMrz2={setMrzLine2}
          onChooseImage={() => fileInputRef.current?.click()}
          onTesseract={onTesseract}
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

// ── upload (PassportB) ────────────────────────────────────────

function PassportUpload({
  status,
  error,
  mrzLine1,
  mrzLine2,
  tesseractBusy,
  fileInputRef,
  onMrz1,
  onMrz2,
  onChooseImage,
  onTesseract,
  onSubmit,
  onFile,
}: {
  status: Status;
  error: string | null;
  mrzLine1: string;
  mrzLine2: string;
  tesseractBusy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onMrz1: (v: string) => void;
  onMrz2: (v: string) => void;
  onChooseImage: () => void;
  onTesseract: () => void;
  onSubmit: () => void;
  onFile: (file: File) => Promise<void>;
}) {
  const busy = status === 'uploading';
  return (
    <>
      <header>
        <h1 className="t-h1">Add your passport</h1>
        <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '60ch' }}>
          The image never leaves your browser. We hash it locally and store only the two MRZ lines,
          encrypted with a per-tenant key.
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
            <div className="t-h2">{busy ? 'Encrypting…' : 'Drop your passport image'}</div>
            <div className="t-body ink-70" style={{ fontSize: 13 }}>
              Or choose a file · Or paste MRZ below
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
                Choose image
              </button>
              <button
                type="button"
                onClick={onTesseract}
                disabled={tesseractBusy || busy}
                style={{
                  ...ghostBtnStyle,
                  padding: '8px 18px',
                  fontSize: 12,
                  opacity: tesseractBusy || busy ? 0.5 : 1,
                  cursor: tesseractBusy || busy ? 'not-allowed' : 'pointer',
                }}
              >
                {tesseractBusy ? 'Scanning…' : 'Scan from image (beta)'}
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

          <form
            onSubmit={e => {
              e.preventDefault();
              onSubmit();
            }}
            style={{
              padding: '24px 28px',
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
            {error ? (
              <p className="t-mono" style={{ color: 'var(--vermillion)', fontSize: 11, margin: 0 }}>
                {error}
              </p>
            ) : null}
            <div>
              <button
                type="submit"
                disabled={!mrzLine1.trim() || !mrzLine2.trim() || busy}
                style={{
                  ...primaryBtnStyle,
                  alignSelf: 'flex-start',
                  opacity: !mrzLine1.trim() || !mrzLine2.trim() || busy ? 0.5 : 1,
                  cursor: !mrzLine1.trim() || !mrzLine2.trim() || busy ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? 'Encrypting…' : 'Save encrypted'}
              </button>
            </div>
          </form>
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

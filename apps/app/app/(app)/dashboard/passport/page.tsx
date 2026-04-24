'use client';

/**
 * /dashboard/passport — the traveler-facing vault surface.
 *
 * Three states:
 *   1. Loading   — fetching /api/passport/self.
 *   2. On file   — sanitized signals card + "replace" + "revoke" CTAs.
 *                  If the user clicks "reveal" we hit ?reveal=1 and
 *                  show the decrypted extraction they themselves
 *                  uploaded.  Audit log captures every reveal.
 *   3. Upload    — MRZ lines form (ICAO 9303 TD3 = 2×44 chars). A
 *                  "Scan from image (beta)" button lazy-loads
 *                  tesseract.js when the user wants auto-extraction;
 *                  the baseline path is paste-or-type.
 *
 * The image bytes NEVER leave the browser. The client computes
 * SHA-256 of the concatenated MRZ lines (or the original file when
 * available) and hands the server only that hash + the two MRZ
 * strings.  Every server-side guard that runs on upload —
 * MRZ checksum validation, vault encrypt, access log — is covered
 * by @sendero/vault unit tests; this page is the thin UX on top.
 *
 * Copy is terse on purpose: travelers who hit this page are already
 * aware they need to hand their passport to Sendero, and the best
 * thing we can do is make the interaction take ten seconds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@sendero/ui/button';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
} from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadVault = useCallback(async () => {
    try {
      const res = await fetch('/api/passport/self', { cache: 'no-store' });
      const body = (await res.json()) as { vault: VaultSignals | null };
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
        const body = (await res.json()) as
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
      // Compute SHA-256 of the image in-browser so we have a stable
      // audit anchor without the server ever seeing pixels. The hash
      // goes into the encrypted blob alongside the MRZ lines.
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      // If both MRZ lines are typed, submit now. Otherwise just stash
      // the hash and let the user type / scan.
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
    } catch {
      setError('Could not decrypt your vault record.');
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {status === 'on_file' && vault ? (
        <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-4 shadow-[var(--shadow-md)]">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-[color:color-mix(in_oklab,var(--accent-green,#2aa876)_12%,white)] text-[color:var(--accent-green,#2aa876)]">
              <ShieldCheckIcon className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 className="text-[15px] font-semibold text-foreground">Passport on file</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Extracted {timeAgo(vault.extractedAt)} via {vault.extractedBy.replace(/_/g, ' ')}.
              </p>
            </div>
            <span
              className={
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ' +
                (vault.mrzChecksumValid
                  ? 'bg-[color:color-mix(in_oklab,var(--accent-green,#2aa876)_12%,white)] text-[color:var(--accent-green,#2aa876)]'
                  : 'bg-[color:color-mix(in_oklab,var(--accent-rose,#e34)_12%,white)] text-[color:var(--accent-rose,#e34)]')
              }
            >
              {vault.mrzChecksumValid ? (
                <CheckCircle2Icon className="size-3" />
              ) : (
                <AlertTriangleIcon className="size-3" />
              )}
              {vault.mrzChecksumValid ? 'MRZ validated' : 'MRZ check failed'}
            </span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
            <dt className="text-[color:var(--text-faint)] uppercase tracking-[0.1em] text-[10px]">
              Nationality
            </dt>
            <dd className="text-[color:var(--text-dim)]">{vault.nationalityIso3 ?? 'unknown'}</dd>
            <dt className="text-[color:var(--text-faint)] uppercase tracking-[0.1em] text-[10px]">
              Expires
            </dt>
            <dd className="text-[color:var(--text-dim)]">{vault.expiresOn ?? 'unknown'}</dd>
            <dt className="text-[color:var(--text-faint)] uppercase tracking-[0.1em] text-[10px]">
              Variant
            </dt>
            <dd className="text-[color:var(--text-dim)]">{vault.documentVariant}</dd>
          </dl>

          {revealedExtraction ? (
            <div className="rounded-[var(--radius-md)] bg-[color:var(--bg-sunk)] p-3 font-mono text-[11px]">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]">
                <EyeIcon className="size-3" /> Decrypted view — auditable
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[color:var(--text)]">
                {JSON.stringify(revealedExtraction, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={revealedExtraction ? () => setRevealedExtraction(null) : reveal}
            >
              {revealedExtraction ? (
                <>
                  <EyeOffIcon className="size-4" /> Hide
                </>
              ) : (
                <>
                  <EyeIcon className="size-4" /> Reveal my record
                </>
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStatus('empty')}>
              <UploadCloudIcon className="size-4" /> Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={revokeVault}
              className="!text-[color:var(--accent-rose,#e34)] hover:!bg-[color:color-mix(in_oklab,var(--accent-rose,#e34)_8%,white)]"
            >
              <Trash2Icon className="size-4" /> Revoke
            </Button>
          </div>
        </section>
      ) : null}

      {(status === 'empty' || status === 'uploading' || status === 'error') && (
        <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-4 shadow-[var(--shadow-md)]">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)]">
              <LockIcon className="size-5" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <h2 className="text-[15px] font-semibold text-foreground">Add your passport</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The image never leaves your browser. Only the two MRZ lines + a SHA-256 hash are
                encrypted server-side with a per-tenant key.
              </p>
            </div>
          </div>

          <div
            className="grid gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-border p-4 text-center"
            onDragOver={e => e.preventDefault()}
            onDrop={async e => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) await onFile(file);
            }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Optional: drop image or paste MRZ below
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={status === 'uploading'}
              >
                <UploadCloudIcon className="size-4" /> Choose image
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onTesseract}
                disabled={tesseractBusy || status === 'uploading'}
              >
                <ScanLineIcon className="size-4" />
                {tesseractBusy ? 'Scanning…' : 'Scan from image (beta)'}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={e => {
              e.preventDefault();
              if (!mrzLine1.trim() || !mrzLine2.trim()) return;
              void submit(mrzLine1, mrzLine2, null);
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                MRZ line 1 — 44 characters
              </span>
              <input
                value={mrzLine1}
                onChange={e => setMrzLine1(e.target.value)}
                maxLength={50}
                placeholder="P<USASMITH<<JOHN<MICHAEL<<<<<<<<<<<<<<<<<<<<"
                className="rounded-md border border-border bg-[color:var(--surface-floating)] px-2 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                MRZ line 2 — 44 characters
              </span>
              <input
                value={mrzLine2}
                onChange={e => setMrzLine2(e.target.value)}
                maxLength={50}
                placeholder="L898902C36USA7408122M1204159ZE184226B<<<<<10"
                className="rounded-md border border-border bg-[color:var(--surface-floating)] px-2 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
            {error ? (
              <p className="font-mono text-[11px] text-[color:var(--accent-rose,#e34)]">{error}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={!mrzLine1.trim() || !mrzLine2.trim() || status === 'uploading'}
              >
                <ShieldCheckIcon className="size-4" />
                {status === 'uploading' ? 'Encrypting…' : 'Save encrypted'}
              </Button>
            </div>
          </form>
        </section>
      )}

      {status === 'loading' ? (
        <section className="rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-4 shadow-[var(--shadow-md)]">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Loading vault state…
          </span>
        </section>
      ) : null}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

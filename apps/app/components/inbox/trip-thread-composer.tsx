'use client';

/**
 * TripThreadComposer — channel-aware composer for the trip inbox, now
 * backed by a tiptap editor with a Sendero Support Writing Assistant
 * bubble menu (fork of the `desk-v1` editor, adapted to the travel/
 * support domain).
 *
 * Pipeline per the spec:
 *   Draft → inline grammar/style suggestion → one-click AI rewrites →
 *   channel preview → send to WhatsApp / Slack / Email.
 *
 * Locale is first-class: the traveler's resolved locale is passed into
 * every rewrite so the AI replies in the traveler's language, and the
 * translate mode emits a target-locale rewrite.
 *
 * Rewrites hit `/api/inbox/rewrite` which runs on the **cheap** model
 * tier (Gemini Flash Lite → Haiku → GPT-mini) via the gateway cascade,
 * with SHA256 in-memory caching — polish/grammar on the same draft is
 * effectively free.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RewriteFn, RewriteRequest, RewriteResponse } from '@sendero/ui/tiptap';
import { SupportEditor } from '@sendero/ui/tiptap';
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  PaperclipIcon,
  ScanLineIcon,
  SendIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';

import { ChannelBadge, type ChannelKindSlug } from '@/components/inbox/channel-badge';

type ComposerMode = 'agent' | 'human';

export interface TripThreadComposerSubmit {
  text: string;
  mode: ComposerMode;
  channel: ChannelKindSlug;
  isInternal: boolean;
}

const BRAND_VOICE = 'calm, premium, helpful, concise — editorial travel guide';

export function TripThreadComposer({
  defaultChannel = 'web',
  disabled = false,
  onSubmit,
  customerName,
  tripStatus,
  locale,
}: {
  defaultChannel?: ChannelKindSlug;
  disabled?: boolean;
  onSubmit: (message: TripThreadComposerSubmit) => void | Promise<void>;
  customerName?: string;
  tripStatus?: string;
  locale: string;
}) {
  const [mode, setMode] = useState<ComposerMode>('agent');
  const [channel, setChannel] = useState<ChannelKindSlug>(defaultChannel);
  const [isInternal, setIsInternal] = useState(false);
  const [text, setText] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [scan, setScan] = useState<ScanState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveChannel: ChannelKindSlug = isInternal ? 'internal' : channel;
  const rewriteChannel =
    effectiveChannel === 'mcp' || effectiveChannel === 'web' ? 'email' : effectiveChannel;

  const rewrite: RewriteFn = useCallback(async req => {
    const res = await fetch('/api/inbox/rewrite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Rewrite failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return (await res.json()) as RewriteResponse;
  }, []);

  const rewriteContext = useMemo(
    () => ({
      customerName,
      tripStatus,
      channel: rewriteChannel,
      brandVoice: BRAND_VOICE,
      locale,
    }),
    [customerName, tripStatus, rewriteChannel, locale]
  );

  const scanFile = useCallback(async (file: File) => {
    setScan({ kind: 'pending', fileName: file.name });
    const form = new FormData();
    form.append('file', file);
    form.append('kind', guessScanKind(file.name));
    try {
      const res = await fetch('/api/scan', { method: 'POST', body: form });
      const payload = (await res.json()) as ScanApiResponse;
      if (!res.ok || 'error' in payload) {
        const message =
          'message' in payload
            ? (payload.message ?? payload.error)
            : 'error' in payload
              ? payload.error
              : 'Extraction failed';
        setScan({ kind: 'error', fileName: file.name, message: String(message) });
        return;
      }
      setScan({
        kind: 'ready',
        fileName: file.name,
        scanKind: payload.kind,
        latencyMs: payload.latencyMs,
        model: payload.model,
        data: payload.data,
      });
    } catch (err) {
      setScan({
        kind: 'error',
        fileName: file.name,
        message: err instanceof Error ? err.message : 'Extraction failed',
      });
    }
  }, []);

  const insertScanSummary = () => {
    if (scan?.kind !== 'ready') return;
    const summary = summarizeScan(scan);
    setText(prev => (prev.trim() ? `${prev.trim()}\n${summary}` : summary));
    setScan(null);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void onSubmit({ text: trimmed, mode, channel: effectiveChannel, isInternal });
    setText('');
    setScan(null);
  };

  const primaryLabel =
    mode === 'agent'
      ? 'Ask agent'
      : isInternal
        ? 'Save note'
        : `Reply via ${CHANNEL_LABELS[channel]}`;
  const primaryHint =
    mode === 'agent'
      ? 'Agent drafts in this thread. Nothing is sent to the traveler yet.'
      : isInternal
        ? 'Internal note — visible only to operators and the agent.'
        : `Reply is delivered to the traveler on ${CHANNEL_LABELS[channel]} · ${locale}.`;

  return (
    // Composer card: raised surface with soft shadow + the one focus
    // ring in the app — a 1px vermillion-at-40% border fades in on
    // focus-within, paired with a shadow lift (DESIGN.md §9, §13.8).
    <div
      className="composer-card rounded-[var(--radius-md)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-sm)] focus-within:shadow-[var(--shadow-md)] transition-[box-shadow,border-color] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
      style={{ border: '1px solid transparent' }}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <ChannelSelect
          value={channel}
          onChange={setChannel}
          disabled={isInternal || mode === 'agent'}
        />
        <label
          className={
            'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 ease-out ' +
            (isInternal
              ? 'border-[color:var(--ink)] bg-[color:var(--bg-sunk)] text-[color:var(--ink)]'
              : 'border-border text-muted-foreground hover:border-[color:var(--ink)]')
          }
        >
          <EyeOffIcon className="size-3" />
          <input
            type="checkbox"
            className="sr-only"
            checked={isInternal}
            onChange={e => setIsInternal(e.target.checked)}
          />
          Internal
        </label>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || scan?.kind === 'pending'}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors duration-150 ease-out hover:border-[color:var(--ink)] hover:text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
          title="Attach and scan a receipt, invoice, or boarding pass"
        >
          {scan?.kind === 'pending' ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <PaperclipIcon className="size-3" />
          )}
          {scan?.kind === 'pending' ? 'Scanning…' : 'Scan doc'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void scanFile(f);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <ChannelBadge channel={effectiveChannel} size="xs" />
          <span>→</span>
          <span>
            {mode === 'agent' ? 'agent first' : isInternal ? 'operators only' : 'traveler'}
          </span>
          <span className="opacity-60">·</span>
          <span>{locale}</span>
        </span>
      </div>

      {scan ? (
        <ScanAttachmentChip
          state={scan}
          onInsert={insertScanSummary}
          onDismiss={() => setScan(null)}
        />
      ) : null}

      <SupportEditor
        value={text}
        onChange={setText}
        placeholder={composerPlaceholder(mode, isInternal, channel, locale)}
        disabled={disabled}
        onEnter={submit}
        rewrite={rewrite}
        context={rewriteContext}
        footerSlot={
          mode === 'human' && !isInternal ? (
            <PolishChip
              text={text}
              context={rewriteContext}
              rewrite={rewrite}
              onAccept={next => setText(next)}
              disabled={disabled}
            />
          ) : null
        }
      />

      {mode === 'human' && !isInternal && text.trim() ? (
        <ChannelPreviewStrip
          text={text}
          channel={channel}
          locale={locale}
          open={showPreview}
          onToggle={() => setShowPreview(v => !v)}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {primaryHint}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="composer-send inline-flex items-center gap-1 bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {primaryLabel}
          {mode === 'agent' ? (
            <ArrowRightIcon className="size-3.5" />
          ) : (
            <SendIcon className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

type ScanDocKind = 'receipt' | 'invoice' | 'boarding_pass';

type ScanState =
  | { kind: 'pending'; fileName: string }
  | { kind: 'error'; fileName: string; message: string }
  | {
      kind: 'ready';
      fileName: string;
      scanKind: ScanDocKind | 'id_document';
      latencyMs: number;
      model: string;
      data: Record<string, unknown>;
    };

type ScanApiResponse =
  | {
      kind: ScanDocKind | 'id_document';
      provider: string;
      model: string;
      latencyMs: number;
      data: Record<string, unknown>;
    }
  | { error: string; message?: string };

function guessScanKind(fileName: string): ScanDocKind {
  const lower = fileName.toLowerCase();
  if (/(invoice|bill|factura|factur|rechnung)/i.test(lower)) return 'invoice';
  if (/(boarding|bp|pnr|flight)/i.test(lower)) return 'boarding_pass';
  return 'receipt';
}

function summarizeScan(scan: ScanState & { kind: 'ready' }): string {
  const d = scan.data;
  if (scan.scanKind === 'boarding_pass') {
    const pax = stringField(d, 'passenger_name');
    const route =
      stringField(d, 'origin_iata') && stringField(d, 'destination_iata')
        ? `${d.origin_iata} → ${d.destination_iata}`
        : '';
    const flight = stringField(d, 'carrier_code')
      ? `${d.carrier_code}${stringField(d, 'flight_number') ?? ''}`
      : (stringField(d, 'flight_number') ?? '');
    const pnr = stringField(d, 'pnr');
    const seat = stringField(d, 'seat');
    return [
      'Boarding pass',
      pax ? `· ${pax}` : '',
      route ? `· ${route}` : '',
      flight ? `· ${flight}` : '',
      pnr ? `· PNR ${pnr}` : '',
      seat ? `· seat ${seat}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (scan.scanKind === 'invoice') {
    const vendor = stringField(d, 'vendor_name');
    const total = numberField(d, 'total_amount');
    const currency = stringField(d, 'currency') ?? '';
    const num = stringField(d, 'invoice_number');
    const date = stringField(d, 'invoice_date');
    return [
      `Invoice${vendor ? ` — ${vendor}` : ''}`,
      total !== null ? `· ${fmtMoney(total, currency)}` : '',
      num ? `· #${num}` : '',
      date ? `· ${date}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  const merchant = stringField(d, 'store_name');
  const total = numberField(d, 'total_amount');
  const currency = stringField(d, 'currency') ?? '';
  const date = stringField(d, 'date');
  return [
    `Receipt${merchant ? ` — ${merchant}` : ''}`,
    total !== null ? `· ${fmtMoney(total, currency)}` : '',
    date ? `· ${date}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function numberField(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmtMoney(amount: number, currency: string): string {
  const cur = currency.trim().toUpperCase();
  if (!cur) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur}`;
  }
}

function ScanAttachmentChip({
  state,
  onInsert,
  onDismiss,
}: {
  state: ScanState;
  onInsert: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-1 flex items-start gap-2 bg-[color:var(--bg-sunk)] px-4 py-2 font-mono text-[11px] text-[color:var(--text)]">
      <ScanLineIcon className="mt-0.5 size-3 shrink-0 text-[color:var(--ink)]" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
          {state.kind === 'pending'
            ? 'Scanning with Gemini 2.5 Flash…'
            : state.kind === 'error'
              ? 'Scan failed'
              : `Extracted in ${state.latencyMs} ms · ${state.model}`}
        </div>
        <div className="truncate text-[color:var(--text-dim)]">
          {state.kind === 'ready' ? summarizeScan(state) : state.fileName}
        </div>
        {state.kind === 'error' ? (
          <div className="mt-0.5 text-[10px] text-[color:var(--accent-rose)]">{state.message}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state.kind === 'ready' ? (
          <button
            type="button"
            onClick={onInsert}
            className="inline-flex items-center gap-1 border border-[color:var(--ink)] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink)] hover:bg-[color:var(--ink)] hover:text-[color:var(--bg-elev)]"
            title="Insert a one-line summary into the reply"
          >
            <CheckIcon className="size-3" /> Insert
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-dim)] hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          title="Dismiss"
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Debounced inline grammar/style suggestion. Fires `grammar` mode
 * ~1.2s after the operator stops typing. Shows a single-line accept /
 * dismiss chip only when the rewrite differs from the draft. Cached
 * server-side, so repeated fires on the same draft are free.
 */
function PolishChip({
  text,
  context,
  rewrite,
  onAccept,
  disabled,
}: {
  text: string;
  context: RewriteRequest['context'];
  rewrite: RewriteFn;
  onAccept: (next: string) => void;
  disabled?: boolean;
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const lastFiredFor = useRef<string>('');

  useEffect(() => {
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 8) {
      setSuggestion(null);
      return;
    }
    if (trimmed === dismissed) {
      setSuggestion(null);
      return;
    }
    if (trimmed === lastFiredFor.current) return;
    const handle = setTimeout(async () => {
      lastFiredFor.current = trimmed;
      setBusy(true);
      try {
        const res = await rewrite({
          message: trimmed,
          mode: 'grammar',
          context,
        });
        // Only surface when the model actually changed something.
        if (res.output && normalize(res.output) !== normalize(trimmed)) {
          setSuggestion(res.output);
        } else {
          setSuggestion(null);
        }
      } catch {
        setSuggestion(null);
      } finally {
        setBusy(false);
      }
    }, 1200);
    return () => clearTimeout(handle);
  }, [text, context, rewrite, dismissed, disabled]);

  if (!suggestion && !busy) return null;

  return (
    <div className="flex items-start gap-2 mt-1 bg-[color:var(--bg-sunk)] px-4 py-2 font-mono text-[11px] text-[color:var(--text)]">
      <SparklesIcon className="mt-0.5 size-3 shrink-0 text-[color:var(--ink)]" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
          {busy ? 'Polishing…' : 'Suggested rewrite'}
        </div>
        {suggestion ? (
          <div className="whitespace-pre-wrap break-words text-[color:var(--text)]">
            {suggestion}
          </div>
        ) : null}
      </div>
      {suggestion ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onAccept(suggestion);
              setSuggestion(null);
              lastFiredFor.current = suggestion;
            }}
            className="inline-flex items-center gap-1 border border-[color:var(--ink)] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink)] hover:bg-[color:var(--ink)] hover:text-[color:var(--bg-elev)]"
            title="Accept rewrite"
          >
            <CheckIcon className="size-3" /> Accept
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(text.trim());
              setSuggestion(null);
            }}
            className="inline-flex items-center gap-1 border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-dim)] hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
            title="Dismiss"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Channel preview strip — shows the draft rendered per the destination
 * channel's convention before the operator sends. Not a full fidelity
 * renderer; its job is to catch "this reads wrong on WhatsApp" mistakes.
 */
function ChannelPreviewStrip({
  text,
  channel,
  locale,
  open,
  onToggle,
}: {
  text: string;
  channel: ChannelKindSlug;
  locale: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-1 bg-[color:var(--bg-sunk)]/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)] hover:text-[color:var(--ink)]"
      >
        <EyeIcon className="size-3" />
        {open ? 'Hide preview' : `Preview on ${CHANNEL_LABELS[channel]} · ${locale}`}
      </button>
      {open ? (
        <div className="mt-1 px-4 pb-3 pt-2">
          <ChannelRender channel={channel} text={text} locale={locale} />
        </div>
      ) : null}
    </div>
  );
}

function ChannelRender({
  channel,
  text,
  locale,
}: {
  channel: ChannelKindSlug;
  text: string;
  locale: string;
}) {
  if (channel === 'whatsapp') {
    return (
      <div className="mx-auto max-w-sm">
        <div className="relative ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3 py-2 text-[13px] text-[#111b21]">
          {text}
          <div className="mt-1 text-right font-mono text-[9px] text-[#667781]">now · {locale}</div>
        </div>
      </div>
    );
  }
  if (channel === 'slack') {
    return (
      <div className="flex gap-2 border-l-2 border-[#611f69] pl-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[color:var(--text)]">Sendero agent</div>
          <div className="whitespace-pre-wrap break-words text-[13px] text-[color:var(--text)]">
            {text}
          </div>
        </div>
      </div>
    );
  }
  if (channel === 'email') {
    return (
      <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg-elev)] p-3 text-[13px]">
        <div className="mb-2 mb-1 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
          From: Sendero Support &lt;support@sendero.app&gt; · {locale}
        </div>
        <div className="whitespace-pre-wrap break-words text-[color:var(--text)]">{text}</div>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap break-words font-mono text-[12px] text-[color:var(--text)]">
      {text}
    </div>
  );
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (next: ComposerMode) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-[color:var(--bg-sunk)] p-0.5 text-[11px] font-mono uppercase tracking-[0.12em]">
      <button
        type="button"
        onClick={() => onChange('agent')}
        aria-pressed={mode === 'agent'}
        className={
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors duration-150 ease-out ' +
          (mode === 'agent'
            ? 'bg-[color:var(--ink)] text-[color:var(--bg-elev)]'
            : 'text-muted-foreground hover:text-[color:var(--ink)]')
        }
      >
        <BotIcon className="size-3" /> Agent
      </button>
      <button
        type="button"
        onClick={() => onChange('human')}
        aria-pressed={mode === 'human'}
        className={
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors duration-150 ease-out ' +
          (mode === 'human'
            ? 'bg-[color:var(--ink)] text-[color:var(--bg-elev)]'
            : 'text-muted-foreground hover:text-[color:var(--ink)]')
        }
      >
        <UserIcon className="size-3" /> Human
      </button>
    </div>
  );
}

function ChannelSelect({
  value,
  onChange,
  disabled,
}: {
  value: ChannelKindSlug;
  onChange: (next: ChannelKindSlug) => void;
  disabled?: boolean;
}) {
  const options: ChannelKindSlug[] = ['web', 'whatsapp', 'slack', 'email'];
  return (
    <label className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      Channel
      <select
        value={value}
        onChange={e => onChange(e.target.value as ChannelKindSlug)}
        disabled={disabled}
        className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {CHANNEL_LABELS[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}

function composerPlaceholder(
  mode: ComposerMode,
  isInternal: boolean,
  channel: ChannelKindSlug,
  locale: string
) {
  if (mode === 'agent') {
    return 'Ask the Sendero agent to search, book, or explain something on this trip…';
  }
  if (isInternal) return 'Internal note — operators and agent only…';
  return `Reply to traveler via ${CHANNEL_LABELS[channel]} (${locale})…`;
}

const CHANNEL_LABELS: Record<ChannelKindSlug, string> = {
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  email: 'Email',
  web: 'Web',
  mcp: 'MCP',
  internal: 'Internal',
};

'use client';

/**
 * Per-step pane renderers for the WhatsApp setup wizard.
 *
 * Each pane is keyed by `payload.promptId` from the workflow def
 * (whatsappProvisionWorkflow) and reads/writes the wizard's
 * `setResolution` so the operator's inputs flow into the WorkflowRun
 * scratchpad on Continue.
 */

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';

import type { WizardPaneProps, WizardPaneRenderer } from './types';

const COUNTRIES = [
  { iso: 'US', label: 'United States' },
  { iso: 'BR', label: 'Brazil' },
  { iso: 'MX', label: 'Mexico' },
  { iso: 'GB', label: 'United Kingdom' },
];

const TEMPLATE_DEFS = [
  {
    id: 'trip_intake_v3',
    label: 'trip_intake_v3',
    description: 'Initial trip-intake greeting (Utility).',
    body: "Hi {{1}}, I'm Sendero — drop your trip details and I'll get to work.",
  },
  {
    id: 'hold_confirmation_v2',
    label: 'hold_confirmation_v2',
    description: 'Sent when a hold is placed (Utility).',
    body: "Held {{1}} ({{2}}) for you. Ticketing in progress; I'll confirm the moment it's issued.",
  },
  {
    id: 'cap_warning_v1',
    label: 'cap_warning_v1',
    description: 'Fires near the spend cap (Utility).',
    body: "You're at {{1}} of your {{2}} cap. Want to extend or pause autopay?",
  },
] as const;

const PILL_FONT =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]';
const FIELD_LABEL =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]';

export const whatsappPanes: Record<string, WizardPaneRenderer> = {
  'whatsapp.pick_number': PickNumberPane,
  'whatsapp.verify_number': VerifyNumberPane,
  'whatsapp.brand_profile': BrandProfilePane,
  'whatsapp.approve_templates': ApproveTemplatesPane,
  'whatsapp.go_live': GoLivePane,
};

// ─── 1. pick number ──────────────────────────────────────────────────

function PickNumberPane({ setResolution, pending }: WizardPaneProps) {
  const [country, setCountry] = useState<string>('US');
  const [numbers, setNumbers] = useState<Array<{ id: string; e164: string; label?: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/channels/whatsapp/numbers?country=${country}`)
      .then(r => r.json())
      .then((data: { numbers: Array<{ id: string; e164: string; label?: string }> }) => {
        if (cancelled) return;
        setNumbers(data.numbers ?? []);
        const first = data.numbers?.[0]?.e164 ?? null;
        setSelected(first);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    if (selected) {
      setResolution({ countryIso: country, e164: selected });
    } else {
      setResolution(null);
    }
  }, [country, selected, setResolution]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Country</label>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRIES.map(c => (
              <button
                key={c.iso}
                type="button"
                onClick={() => setCountry(c.iso)}
                className={
                  'rounded-full border px-3 py-1.5 text-[12px] transition-colors ' +
                  (country === c.iso
                    ? 'border-[color:var(--accent-rose)] bg-[color:var(--accent-rose)] text-white'
                    : 'border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-transparent text-[color:var(--text)] hover:border-[color:var(--ink)]')
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Available numbers</label>
          {loading ? (
            <p className="text-sm text-[color:var(--text-dim)]">Loading…</p>
          ) : numbers.length === 0 ? (
            <p className="text-sm text-[color:var(--text-dim)]">
              No numbers available in this country yet. Pick another or contact support.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] overflow-hidden rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)]">
              {numbers.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setSelected(n.e164)}
                    className={
                      'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ' +
                      (selected === n.e164
                        ? 'bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)]'
                        : 'hover:bg-[color:color-mix(in_oklab,var(--ink)_4%,transparent)]')
                    }
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-[14px] tracking-tight text-[color:var(--ink)]">
                        {n.e164}
                      </span>
                      {n.label ? (
                        <span className="text-[11px] text-[color:var(--text-dim)]">{n.label}</span>
                      ) : null}
                    </div>
                    {selected === n.e164 ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--accent-rose)] text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <NumberPreview e164={selected} />
    </div>
  );
}

function NumberPreview({ e164 }: { e164: string | null }) {
  return (
    <aside className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
      <span className={PILL_FONT}>What recipients see</span>
      <div className="flex items-center gap-2">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color:#25D366] text-white">
          <span className="font-serif text-[14px]">S</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-[color:var(--ink)]">Sendero</span>
          <span className="text-[11px] text-[color:var(--text-dim)]">{e164 ?? '—'}</span>
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-dim)]">
        Sendero owns the WhatsApp Business Account. You share this number with travelers; we handle
        delivery + Meta compliance.
      </p>
    </aside>
  );
}

// ─── 2. verify number ────────────────────────────────────────────────

function VerifyNumberPane({ scratchpad, setResolution }: WizardPaneProps) {
  const reservation = scratchpad.reservation as
    | { e164?: string; phoneNumberId?: string; status?: string }
    | undefined;
  useEffect(() => {
    setResolution({ acknowledged: true });
  }, [setResolution]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Provisioned number</span>
          <span className="font-mono text-[26px] tracking-tight text-[color:var(--ink)]">
            {reservation?.e164 ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--accent-green,#16a34a)] text-white">
            <Check className="h-3 w-3" />
          </span>
          <span className="text-sm text-[color:var(--text)]">
            Verified via Sendero&rsquo;s shared WhatsApp Business Account.
          </span>
        </div>
        <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
          You can skip Meta business verification — Sendero already passed it once and shares the
          umbrella account. Continue to brand the experience.
        </p>
      </div>
      <aside className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <span className={PILL_FONT}>Connection ID</span>
        <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
          {reservation?.phoneNumberId ?? 'pending'}
        </span>
      </aside>
    </div>
  );
}

// ─── 3. brand the experience ─────────────────────────────────────────

function BrandProfilePane({ setResolution }: WizardPaneProps) {
  const [displayName, setDisplayName] = useState('Sendero');
  const [about, setAbout] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [defaultGreeting, setDefaultGreeting] = useState(
    "Hi 👋 I'm here to help with your trip — drop your details and I'll get to work."
  );

  useEffect(() => {
    if (!displayName.trim()) {
      setResolution(null);
      return;
    }
    setResolution({
      displayName: displayName.trim(),
      about: about.trim() || undefined,
      profilePhotoUrl: profilePhotoUrl.trim() || undefined,
      defaultGreeting: defaultGreeting.trim() || undefined,
    });
  }, [displayName, about, profilePhotoUrl, defaultGreeting, setResolution]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Field label="Display name" hint="Max 64 characters.">
          <input
            type="text"
            maxLength={64}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Profile photo URL" hint="Square, 640×640 recommended.">
          <input
            type="url"
            value={profilePhotoUrl}
            placeholder="https://…/logo.png"
            onChange={e => setProfilePhotoUrl(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Short bio" hint="Up to 139 characters.">
          <input
            type="text"
            maxLength={139}
            value={about}
            placeholder="Travel made for the fast lane."
            onChange={e => setAbout(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Default greeting" hint="First message Sendero sends a new traveler.">
          <textarea
            rows={3}
            maxLength={2000}
            value={defaultGreeting}
            onChange={e => setDefaultGreeting(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm leading-relaxed text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
      </div>
      <BrandPreview
        displayName={displayName}
        photoUrl={profilePhotoUrl}
        greeting={defaultGreeting}
      />
    </div>
  );
}

function BrandPreview({
  displayName,
  photoUrl,
  greeting,
}: {
  displayName: string;
  photoUrl: string;
  greeting: string;
}) {
  return (
    <aside className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[#075E54] p-4 text-white shadow-md">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">
        Live preview
      </span>
      <header className="flex items-center gap-2 border-b border-white/15 pb-3">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={displayName}
            width={36}
            height={36}
            className="h-9 w-9 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 font-serif text-[14px]">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold leading-tight">
            {displayName || 'Sendero'}
          </span>
          <span className="text-[11px] text-white/70">online</span>
        </div>
      </header>
      <div className="mt-3 max-w-[230px] self-start rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[12px] leading-snug text-[#0c1f1c]">
        {greeting || 'Type a greeting to preview…'}
      </div>
    </aside>
  );
}

// ─── 4. approve templates ────────────────────────────────────────────

function ApproveTemplatesPane({ setResolution }: WizardPaneProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set(TEMPLATE_DEFS.map(t => t.id)));

  useEffect(() => {
    if (picked.size === 0) {
      setResolution(null);
      return;
    }
    setResolution({ templateNames: Array.from(picked) });
  }, [picked, setResolution]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        Submitted as <strong className="text-[color:var(--ink)]">Utility</strong> templates; Meta
        typically approves utility templates within minutes.
      </p>
      <ul className="flex flex-col divide-y divide-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] overflow-hidden rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)]">
        {TEMPLATE_DEFS.map(t => {
          const on = picked.has(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(prev => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  });
                }}
                className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[color:color-mix(in_oklab,var(--ink)_4%,transparent)]"
              >
                <span
                  className={
                    'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ' +
                    (on
                      ? 'border-[color:var(--accent-rose)] bg-[color:var(--accent-rose)] text-white'
                      : 'border-[color:color-mix(in_oklab,var(--ink)_25%,transparent)] bg-white')
                  }
                >
                  {on ? <Check className="h-3 w-3" /> : null}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[12px] tracking-tight text-[color:var(--ink)]">
                    {t.label}
                  </span>
                  <span className="text-[11px] text-[color:var(--text-dim)]">{t.description}</span>
                  <span className="font-mono text-[11px] text-[color:var(--text-faint)]">
                    {t.body}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── 5. go live ──────────────────────────────────────────────────────

function GoLivePane({ scratchpad, setResolution }: WizardPaneProps) {
  const reservation = scratchpad.reservation as { e164?: string } | undefined;
  const [sendTest, setSendTest] = useState(true);
  const [testToE164, setTestToE164] = useState('');
  const [testBody, setTestBody] = useState('Sendero test ping. You are connected.');

  const ready = useMemo(() => !sendTest || /^\+\d{6,}$/.test(testToE164), [sendTest, testToE164]);

  useEffect(() => {
    if (!ready) {
      setResolution(null);
      return;
    }
    setResolution({
      sendTest,
      testToE164: sendTest ? testToE164 : undefined,
      testBody: sendTest ? testBody : undefined,
    });
  }, [ready, sendTest, testToE164, testBody, setResolution]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <p className="text-sm text-[color:var(--text)]">
          Going live on{' '}
          <strong className="font-mono text-[color:var(--ink)]">{reservation?.e164 ?? '—'}</strong>.
          Sendero will start routing inbound traveler messages here once you Continue.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm text-[color:var(--text)]">
        <input
          type="checkbox"
          checked={sendTest}
          onChange={e => setSendTest(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[color:var(--accent-rose)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-[color:var(--ink)]">Send a test ping first</span>
          <span className="text-[12px] text-[color:var(--text-dim)]">
            We&rsquo;ll WhatsApp the message below to your phone before flipping the channel live.
          </span>
        </span>
      </label>
      {sendTest ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
          <Field label="Your phone (E.164)" hint="e.g. +14155551234">
            <input
              type="tel"
              value={testToE164}
              placeholder="+14155551234"
              onChange={e => setTestToE164(e.target.value)}
              className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 font-mono text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            />
          </Field>
          <Field label="Message body" hint="Up to 1024 characters.">
            <textarea
              rows={2}
              maxLength={1024}
              value={testBody}
              onChange={e => setTestBody(e.target.value)}
              className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

// ─── shared ──────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={FIELD_LABEL}>{label}</label>
      {children}
      {hint ? <span className="text-[11px] text-[color:var(--text-faint)]">{hint}</span> : null}
    </div>
  );
}

'use client';

/**
 * TravelerOnboardingCard — the 10-second aha-moment unlock.
 *
 * Shown on the dashboard home when the signed-in user hasn't yet
 * declared their passport nationality + expiry.  Two fields, one
 * submit button.  Writes to /api/traveler/profile which stores the
 * (non-PII) declaration on User.metadata.travelerProfile.
 *
 * The card self-hides once populated.  The traveler can still upload a
 * full MRZ-validated passport via /dashboard/passport later; this card
 * is the friction-free T1 path that unlocks visa-aware search + quotes
 * before we ever ask for a document.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@sendero/ui/button';
import { ArrowRightIcon, CheckIcon, GlobeIcon, XIcon } from 'lucide-react';

interface DeclaredProfile {
  nationalityIso3: string;
  expiresOn: string; // YYYY-MM-DD
  declaredAt: string;
}

// Curated top-30 nationalities — covers > 85% of corporate travel
// volume we care about.  Users in long-tail countries fall through to
// a free-form input.
const TOP_NATIONALITIES: Array<{ iso3: string; label: string; flag: string }> = [
  { iso3: 'USA', label: 'United States', flag: '🇺🇸' },
  { iso3: 'GBR', label: 'United Kingdom', flag: '🇬🇧' },
  { iso3: 'CAN', label: 'Canada', flag: '🇨🇦' },
  { iso3: 'MEX', label: 'Mexico', flag: '🇲🇽' },
  { iso3: 'BRA', label: 'Brazil', flag: '🇧🇷' },
  { iso3: 'ARG', label: 'Argentina', flag: '🇦🇷' },
  { iso3: 'CHL', label: 'Chile', flag: '🇨🇱' },
  { iso3: 'COL', label: 'Colombia', flag: '🇨🇴' },
  { iso3: 'FRA', label: 'France', flag: '🇫🇷' },
  { iso3: 'DEU', label: 'Germany', flag: '🇩🇪' },
  { iso3: 'ESP', label: 'Spain', flag: '🇪🇸' },
  { iso3: 'ITA', label: 'Italy', flag: '🇮🇹' },
  { iso3: 'PRT', label: 'Portugal', flag: '🇵🇹' },
  { iso3: 'NLD', label: 'Netherlands', flag: '🇳🇱' },
  { iso3: 'CHE', label: 'Switzerland', flag: '🇨🇭' },
  { iso3: 'SWE', label: 'Sweden', flag: '🇸🇪' },
  { iso3: 'NOR', label: 'Norway', flag: '🇳🇴' },
  { iso3: 'IRL', label: 'Ireland', flag: '🇮🇪' },
  { iso3: 'JPN', label: 'Japan', flag: '🇯🇵' },
  { iso3: 'KOR', label: 'South Korea', flag: '🇰🇷' },
  { iso3: 'SGP', label: 'Singapore', flag: '🇸🇬' },
  { iso3: 'AUS', label: 'Australia', flag: '🇦🇺' },
  { iso3: 'NZL', label: 'New Zealand', flag: '🇳🇿' },
  { iso3: 'IND', label: 'India', flag: '🇮🇳' },
  { iso3: 'CHN', label: 'China', flag: '🇨🇳' },
  { iso3: 'ZAF', label: 'South Africa', flag: '🇿🇦' },
  { iso3: 'ARE', label: 'United Arab Emirates', flag: '🇦🇪' },
  { iso3: 'TUR', label: 'Türkiye', flag: '🇹🇷' },
  { iso3: 'ISR', label: 'Israel', flag: '🇮🇱' },
];

type Status = 'loading' | 'empty' | 'editing' | 'saving' | 'done' | 'error' | 'dismissed';

export function TravelerOnboardingCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<DeclaredProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nationalityIso3, setNationalityIso3] = useState<string>('USA');
  const [expiryYear, setExpiryYear] = useState<number>(() => new Date().getFullYear() + 5);
  const [expiryMonth, setExpiryMonth] = useState<number>(() => new Date().getMonth() + 1);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let aborted = false;
    async function load() {
      try {
        const res = await fetch('/api/traveler/profile', { cache: 'no-store' });
        const body = (await res.json()) as { profile: DeclaredProfile | null };
        if (aborted || !mounted.current) return;
        if (body.profile) {
          setProfile(body.profile);
          setStatus('done');
        } else {
          setStatus('empty');
        }
      } catch {
        if (!aborted && mounted.current) setStatus('empty');
      }
    }
    void load();
    return () => {
      aborted = true;
    };
  }, []);

  const save = useCallback(async () => {
    setStatus('saving');
    setError(null);
    try {
      const expiry = `${expiryYear.toString().padStart(4, '0')}-${expiryMonth.toString().padStart(2, '0')}`;
      const res = await fetch('/api/traveler/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nationalityIso3, expiry }),
      });
      const body = (await res.json()) as
        | { profile: DeclaredProfile }
        | { error: string; message?: string };
      if (!res.ok || 'error' in body) {
        const msg =
          'message' in body ? body.message : 'error' in body ? body.error : 'Unknown error';
        setError(String(msg));
        setStatus('error');
        return;
      }
      setProfile(body.profile);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    }
  }, [nationalityIso3, expiryYear, expiryMonth]);

  if (status === 'loading' || status === 'done' || status === 'dismissed') return null;

  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return (
    <section className="relative grid gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-4 shadow-[var(--shadow-md)] md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <div className="grid size-10 place-items-center rounded-full bg-[color:var(--tint-vermillion-soft)] text-[color:var(--ink)]">
        <GlobeIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-normal text-foreground">
          Set your travel profile · 10 seconds
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
          Pick your passport nationality and expiry so the agent can quote visa-aware trips right
          away. You can upload the full document later — we only ask for it when a trip actually
          needs it.
        </p>
        {status === 'empty' ? (
          <button
            type="button"
            onClick={() => setStatus('editing')}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--ink)] hover:underline"
          >
            Start setup <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {status === 'editing' || status === 'saving' || status === 'error' ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[220px] flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Passport nationality
              </span>
              <select
                value={nationalityIso3}
                onChange={e => setNationalityIso3(e.target.value)}
                disabled={status === 'saving'}
                className="rounded-md border border-border bg-[color:var(--surface-floating)] px-2 py-1.5 text-sm text-foreground"
              >
                {TOP_NATIONALITIES.map(n => (
                  <option key={n.iso3} value={n.iso3}>
                    {n.flag} {n.label} ({n.iso3})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Expiry month
              </span>
              <select
                value={expiryMonth}
                onChange={e => setExpiryMonth(Number.parseInt(e.target.value, 10))}
                disabled={status === 'saving'}
                className="rounded-md border border-border bg-[color:var(--surface-floating)] px-2 py-1.5 text-sm text-foreground"
              >
                {months.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Expiry year
              </span>
              <select
                value={expiryYear}
                onChange={e => setExpiryYear(Number.parseInt(e.target.value, 10))}
                disabled={status === 'saving'}
                className="rounded-md border border-border bg-[color:var(--surface-floating)] px-2 py-1.5 text-sm text-foreground"
              >
                {years.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <p className="w-full text-xs text-[color:var(--accent-rose)]">{error}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {status === 'editing' || status === 'error' ? (
          <Button type="button" onClick={save}>
            <CheckIcon className="size-4" aria-hidden="true" />
            Save profile
          </Button>
        ) : null}
        {status === 'saving' ? (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-[color:var(--ink)]" /> Saving…
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setStatus('dismissed')}
          className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--bg-sunk)] hover:text-[color:var(--ink)]"
          title="Dismiss (you can set this later in settings)"
          aria-label="Dismiss"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {profile ? `Profile saved: ${profile.nationalityIso3} expires ${profile.expiresOn}` : ''}
      </span>
    </section>
  );
}

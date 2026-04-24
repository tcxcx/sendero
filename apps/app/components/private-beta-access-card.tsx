import { submitPrivateBetaAccess } from '@/lib/private-beta-actions';
import type { AuthCopy } from '@/lib/auth-copy';

import { WaitlistCard } from './waitlist-card';

type PrivateBetaAccessCardProps = {
  mode: 'sign-in' | 'sign-up';
  returnTo: string;
  showWaitlist?: boolean;
  waitlistPrecheck: AuthCopy['waitlistPrecheck'];
};

export function PrivateBetaAccessCard({
  mode,
  returnTo,
  showWaitlist = false,
  waitlistPrecheck,
}: PrivateBetaAccessCardProps) {
  if (showWaitlist) {
    return (
      <div className="grid gap-4">
        <div className="border border-[var(--ink)] bg-[color-mix(in_oklab,var(--ink)_6%,var(--bg-elev))] p-5">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
            Private beta whitelist
          </p>
          <h2 className="m-0 mt-3 text-2xl font-medium tracking-normal text-[var(--text)]">
            You are not part of the private beta whitelist yet.
          </h2>
          <p className="m-0 mt-3 text-sm leading-6 text-[var(--text-dim)]">
            Join the waitlist and we will notify you when your operator workspace is approved.
          </p>
        </div>
        <WaitlistCard precheck={waitlistPrecheck} />
      </div>
    );
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--bg-elev)] p-6">
      <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
        Private beta whitelist
      </p>
      <h2 className="m-0 mt-4 text-2xl font-medium tracking-normal text-[var(--text)]">
        You are not part of the private beta whitelist yet.
      </h2>
      <p className="m-0 mt-3 text-sm leading-6 text-[var(--text-dim)]">
        Enter an approved email or wallet address. If it is not on the private list, email checks
        are added to Clerk's waitlist and we route you there instead of loading the{' '}
        {mode === 'sign-up' ? 'sign-up' : 'sign-in'} form.
      </p>

      <form action={submitPrivateBetaAccess} className="mt-6 grid gap-3">
        <input name="returnTo" type="hidden" value={returnTo} />
        <label className="grid gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Email or wallet address
          </span>
          <input
            autoComplete="email"
            className="h-11 border border-[var(--border)] bg-white px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--ink)]"
            name="identifier"
            placeholder="operator@agency.com or 0x..."
            required
            type="text"
          />
        </label>
        <button
          className="h-11 border border-[var(--ink)] bg-[var(--ink)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-[var(--ink)]/90"
          type="submit"
        >
          Check access
        </button>
      </form>
    </div>
  );
}

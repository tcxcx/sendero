'use client';

type ClerkLoadingCardProps = {
  label: string;
  detail: string;
};

export function ClerkLoadingCard({ label, detail }: ClerkLoadingCardProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-full border border-[var(--border)] bg-[var(--bg-elev)] p-6 text-[var(--text)] shadow-[0_18px_60px_rgba(15,15,15,0.06)]"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
            Secure identity
          </p>
          <h2 className="m-0 mt-2 text-xl font-medium tracking-normal">{label}</h2>
        </div>
        <div className="size-3 animate-pulse bg-[var(--ink)]" aria-hidden="true" />
      </div>
      <p className="m-0 mb-6 text-sm leading-6 text-[var(--text-dim)]">{detail}</p>
      <div className="grid gap-3">
        <div className="h-11 animate-pulse border border-[var(--border)] bg-[var(--bg-sunk)]" />
        <div className="h-11 animate-pulse border border-[var(--border)] bg-[var(--bg-sunk)]" />
        <div className="h-11 animate-pulse bg-[var(--ink)]" />
      </div>
      <div className="mt-6 border border-[var(--border)] bg-[var(--bg-sunk)] p-4">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
          Clerk connection delayed
        </p>
        <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">
          The secure identity service is still negotiating the local development session.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            className="h-10 border border-[var(--ink)] bg-[var(--ink)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload identity
          </button>
          <a
            className="flex h-10 items-center justify-center border border-[var(--border)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text)] no-underline"
            href="/waitlist"
          >
            Request access
          </a>
        </div>
      </div>
    </div>
  );
}

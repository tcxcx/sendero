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
    </div>
  );
}

/**
 * Phase A — context slot skeleton.
 *
 * Drops in instantly when the slot's async page.tsx is awaiting its
 * Postgres roundtrip. Layout matches the real component so the page
 * doesn't shift when the data lands.
 */

export default function ContextLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--surface-muted,#888)]">
          Trip context
        </span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
          Recent events
        </h3>
        <ul className="flex flex-col gap-1.5">
          {[0, 1, 2].map(i => (
            <li
              key={i}
              className="flex flex-col gap-1 rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-2"
            >
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--surface-muted,#888)]">
          Recent bookings
        </h3>
        <ul className="flex flex-col gap-1.5">
          {[0, 1].map(i => (
            <li
              key={i}
              className="flex items-center justify-between rounded border border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)] p-2"
            >
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded bg-[color:var(--surface-border,rgba(0,0,0,0.08))] ${className}`}
      aria-hidden="true"
    />
  );
}

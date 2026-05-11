/**
 * Phase B — KPI strip skeleton. Layout matches the real component
 * so the row doesn't shift when data lands.
 */

export default function KpisLoading() {
  return (
    <div className="border-b border-[color:var(--surface-border,rgba(0,0,0,0.08))] bg-[color:var(--surface-raised,#fff)]/60 px-4 py-3">
      <div className="grid grid-cols-3 gap-0 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 px-3 ${
              i < 4 ? 'border-r border-[color:var(--surface-border,rgba(0,0,0,0.08))]' : ''
            } ${i >= 3 ? 'hidden sm:flex' : ''}`}
          >
            <Skeleton className="h-2 w-12" />
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
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

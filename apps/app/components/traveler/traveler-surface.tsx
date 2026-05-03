/**
 * Shared visual primitives for `/me/*` traveler surfaces.
 *
 * Mirrors the `/dashboard/reputation` shell so the consumer-facing
 * pages share the operator dashboard's display-grade rhythm:
 *   - "Sendero × Arc" eyebrow
 *   - `font-display text-3xl` heading
 *   - One-sentence subhead
 *   - Stat grid (2/4 columns)
 *   - Dashed empty-state cards
 *
 * Pages compose these instead of hand-rolling layout each time.
 */

import Link from 'next/link';

export function TravelerSurfaceHeader({
  eyebrow = 'Sendero · me',
  title,
  subhead,
}: {
  eyebrow?: string;
  title: string;
  subhead?: string;
}) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
      <h1 className="font-display text-3xl">{title}</h1>
      {subhead ? <p className="text-sm text-muted-foreground">{subhead}</p> : null}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="font-display text-2xl">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</section>;
}

/**
 * Dashed empty-state card. Default uses a centered headline + body but
 * accepts arbitrary children for richer empty states.
 */
export function EmptyStateCard({
  title,
  body,
  children,
  cta,
}: {
  title?: string;
  body?: React.ReactNode;
  children?: React.ReactNode;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
      {title ? <p className="font-display text-xl">{title}</p> : null}
      {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
      {children ?? null}
      {cta ? (
        <p className="mt-4">
          <Link
            href={cta.href}
            className="inline-flex rounded-md border border-border px-3 py-2 text-xs uppercase tracking-[0.14em] hover:bg-muted"
          >
            {cta.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Traveler surface frame — wraps every `/me/*` page content with the
 * same max-width + spacing the operator dashboard uses for its detail
 * surfaces. Use this directly inside the page; the layout already
 * provides the outer header + tab nav.
 */
export function TravelerSurface({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-8 pt-2 pb-8">{children}</div>;
}

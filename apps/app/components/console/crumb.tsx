/**
 * Crumb — shared breadcrumb atom from `route-artboards.jsx::Crumb`.
 *
 * Renders a horizontal trail of `.t-meta` segments separated by 3px
 * dot glyphs. Last segment uses `--midnight` ink so the user can see
 * the active page; preceding segments inherit the muted body ink.
 */

export function Crumb({ trail }: { trail: string[] }) {
  // Per Design review (autoplan H5): a single-segment crumb is just a
  // bald label that duplicates the page header. With parent prefixes
  // already trimmed across the app, render nothing when there's only
  // one segment — let the h1 carry the page identity. Multi-segment
  // crumbs still render so deep routes (trips/[id]/cancel, etc.) keep
  // their navigation context.
  if (trail.length <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {trail.map((segment, i) => (
        <span
          key={`${segment}-${i}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          {i > 0 ? (
            <span
              aria-hidden
              style={{ width: 3, height: 3, borderRadius: 2, background: 'rgba(31,42,68,0.3)' }}
            />
          ) : null}
          <span
            className="t-meta"
            style={{ color: i === trail.length - 1 ? 'var(--midnight)' : undefined }}
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}

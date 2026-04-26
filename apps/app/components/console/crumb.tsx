/**
 * Crumb — shared breadcrumb atom from `route-artboards.jsx::Crumb`.
 *
 * Renders a horizontal trail of `.t-meta` segments separated by 3px
 * dot glyphs. Last segment uses `--midnight` ink so the user can see
 * the active page; preceding segments inherit the muted body ink.
 */

export function Crumb({ trail }: { trail: string[] }) {
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

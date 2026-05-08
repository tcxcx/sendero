/**
 * Skeleton for the @threads slot. Mirrors the collapsed InboxRail's
 * 44px-wide column with stacked count placeholders so the page does
 * not jump when the real rail streams in. Operators see this for a
 * frame on cold loads while the trip query lands.
 */
export default function ThreadsLoading() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 44,
        flexShrink: 0,
        borderRight: '1px solid var(--ink, rgba(31,42,68,0.18))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 6px',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: 'color-mix(in oklab, var(--ink, #1f2a44) 6%, transparent)',
        }}
      />
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          alignItems: 'center',
          paddingBottom: 12,
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`count-${i}`}
            style={{
              width: 22,
              height: 18,
              borderRadius: 4,
              background: 'color-mix(in oklab, var(--ink, #1f2a44) 5%, transparent)',
            }}
          />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={`row-${i}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'color-mix(in oklab, var(--ink, #1f2a44) 5%, transparent)',
            border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 14%, transparent)',
          }}
        />
      ))}
    </div>
  );
}

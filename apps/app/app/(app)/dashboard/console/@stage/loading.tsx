/**
 * Stage slot skeleton — flexible-width placeholder so the grid column
 * keeps its dimensions while the client island mounts and reads from
 * Zustand. Stage itself has no server fetch; this skeleton just keeps
 * the layout stable for the first paint.
 */
export default function StageLoading() {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          height: 220,
          borderRadius: 12,
          background: 'color-mix(in oklab, var(--ink, #1f2a44) 4%, transparent)',
          border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 12%, transparent)',
        }}
      />
      <div
        style={{
          height: 96,
          borderRadius: 12,
          background: 'color-mix(in oklab, var(--ink, #1f2a44) 4%, transparent)',
          border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 12%, transparent)',
        }}
      />
    </div>
  );
}

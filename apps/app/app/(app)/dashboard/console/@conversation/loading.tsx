/**
 * @conversation slot skeleton — channel header chip + 3 message stubs +
 * composer placeholder. Keeps the column dimensions stable while the
 * focused-trip fetch lands.
 */
export default function ConversationLoading() {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '8px 16px',
      }}
    >
      <div
        style={{
          height: 44,
          borderRadius: 8,
          background: 'color-mix(in oklab, var(--ink, #1f2a44) 5%, transparent)',
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {[64, 96, 80].map((h, i) => (
          <div
            key={`m-${i}`}
            style={{
              height: h,
              maxWidth: '60%',
              alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end',
              borderRadius: 14,
              background: 'color-mix(in oklab, var(--ink, #1f2a44) 4%, transparent)',
              border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          height: 56,
          borderRadius: 10,
          background: 'color-mix(in oklab, var(--ink, #1f2a44) 5%, transparent)',
        }}
      />
    </div>
  );
}

// packages/invoicing/src/templates/html/components/qr-code.tsx
export function QRCode({ dataUrl }: { dataUrl: string }) {
  if (!dataUrl) return null;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: 32,
      }}
    >
      <img
        src={dataUrl}
        alt="Scan to view invoice online"
        style={{
          width: 96,
          height: 96,
          padding: 4,
          background: '#ffffff',
          border: '1px solid #e9e3da',
          borderRadius: 4,
        }}
      />
    </div>
  );
}

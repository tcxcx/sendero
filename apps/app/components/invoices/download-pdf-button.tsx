'use client';

import { Download } from 'lucide-react';
import { Button } from '@sendero/ui/button';

export function DownloadPdfButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  async function download() {
    const response = await fetch(`/api/invoices/${invoiceId}/pdf`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${number}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" onClick={download}>
      <Download data-icon="inline-start" />
      Download PDF
    </Button>
  );
}

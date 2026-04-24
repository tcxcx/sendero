'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@sendero/ui/sheet';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PrefundForm, type PrefundResult } from './prefund-form';
import { PrefundSuccess } from './prefund-success';

export function PrefundSheet({ open }: { open: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<PrefundResult | null>(null);

  function close() {
    setResult(null);
    router.push('/app/trips');
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={value => !value && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Create prepaid trip</SheetTitle>
          <SheetDescription>
            Prefund a traveler escrow, then send the claim link over WhatsApp, Slack, or email.
          </SheetDescription>
        </SheetHeader>
        {result ? (
          <PrefundSuccess result={result} onDone={close} />
        ) : (
          <PrefundForm onSuccess={setResult} />
        )}
      </SheetContent>
    </Sheet>
  );
}

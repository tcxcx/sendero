'use client';

import { Waitlist } from '@clerk/nextjs';

export function WaitlistCard() {
  return (
    <Waitlist
      signInUrl="/sign-in"
      afterJoinWaitlistUrl="/"
      appearance={{
        elements: {
          header: 'hidden',
          card: 'shadow-none border border-neutral-200',
        },
      }}
    />
  );
}

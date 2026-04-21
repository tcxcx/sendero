'use client';

import { Waitlist } from '@clerk/nextjs';

export function MarketingWaitlist() {
  return (
    <Waitlist
      afterJoinWaitlistUrl="/"
      appearance={{
        elements: {
          rootBox: 'mk-waitlist-clerk-root',
          cardBox: 'mk-waitlist-clerk-card',
          header: 'mk-waitlist-clerk-hidden',
          footer: 'mk-waitlist-clerk-hidden',
          formButtonPrimary: 'mk-waitlist-clerk-button',
          formFieldInput: 'mk-waitlist-clerk-input',
        },
      }}
    />
  );
}

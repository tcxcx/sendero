'use client';

import { ClerkLoaded, ClerkLoading, Waitlist } from '@clerk/nextjs';

export function MarketingWaitlist() {
  return (
    <>
      <ClerkLoading>
        <div className="mk-waitlist-loading" aria-busy="true" aria-live="polite">
          <span>Loading secure waitlist</span>
          <div aria-hidden="true" />
          <div aria-hidden="true" />
          <div className="mk-waitlist-recovery">
            <strong>Clerk connection delayed</strong>
            <p>The secure waitlist is still negotiating the local development session.</p>
            <button onClick={() => window.location.reload()} type="button">
              Reload waitlist
            </button>
          </div>
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <Waitlist
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
      </ClerkLoaded>
    </>
  );
}

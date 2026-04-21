'use client';

import { ClerkLoaded, ClerkLoading, SignUp } from '@clerk/nextjs';
import { ClerkLoadingCard } from './clerk-loading-card';

export function SenderoSignUp() {
  return (
    <>
      <ClerkLoading>
        <ClerkLoadingCard
          label="Preparing access request"
          detail="Loading the waitlist identity flow before tenant setup, policy, channels, and settlement."
        />
      </ClerkLoading>
      <ClerkLoaded>
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          waitlistUrl="/waitlist"
          fallbackRedirectUrl="/onboarding"
          appearance={{
            elements: {
              rootBox: '!w-full',
              header: 'hidden',
              footer: 'hidden',
              cardBox: '!w-full !max-w-none shadow-none rounded-none',
              card: '!w-full shadow-none rounded-none border border-[var(--border)] bg-[var(--bg-elev)]',
              formButtonPrimary:
                'rounded-none bg-[var(--ink)] font-mono text-[11px] uppercase tracking-[0.12em] shadow-none hover:bg-[var(--ink)]/90',
              formFieldInput: 'rounded-none border-[var(--border)] shadow-none',
            },
          }}
        />
      </ClerkLoaded>
    </>
  );
}

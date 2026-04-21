'use client';

import { ClerkLoaded, ClerkLoading, SignIn } from '@clerk/nextjs';
import { ClerkLoadingCard } from './clerk-loading-card';

export function SenderoSignIn() {
  return (
    <>
      <ClerkLoading>
        <ClerkLoadingCard
          label="Opening sign in"
          detail="Loading Clerk so your operator workspace stays behind a verified identity."
        />
      </ClerkLoading>
      <ClerkLoaded>
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          waitlistUrl="/waitlist"
          fallbackRedirectUrl="/app"
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

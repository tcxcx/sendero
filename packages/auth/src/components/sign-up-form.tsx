'use client';

import { ClerkLoaded, ClerkLoading, SignUp } from '@clerk/nextjs';

import { ClerkFormSkeleton } from './clerk-form-skeleton';

export default function SignUpForm() {
  return (
    <>
      <ClerkLoading>
        <ClerkFormSkeleton />
      </ClerkLoading>
      <ClerkLoaded>
        <div className="s-fade">
          <SignUp
            routing="path"
            path="/sign-up"
            oauthFlow="redirect"
            signInUrl="/sign-in"
            waitlistUrl="/waitlist"
            fallbackRedirectUrl="/onboarding"
            signInFallbackRedirectUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: '!w-full',
                header: 'hidden',
                footer: 'hidden',
                cardBox: '!w-full !max-w-none shadow-none rounded-none',
                card: '!w-full shadow-none rounded-none border border-[var(--border)] bg-[var(--bg-elev)]',
                formButtonPrimary:
                  'rounded-none bg-[var(--ink)] font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-none hover:bg-[var(--ink)]/90',
                formFieldInput: 'rounded-none border-[var(--border)] shadow-none',
              },
            }}
          />
        </div>
      </ClerkLoaded>
    </>
  );
}

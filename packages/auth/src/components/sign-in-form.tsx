'use client';

import { ClerkLoaded, ClerkLoading, SignIn } from '@clerk/nextjs';

import { ClerkFormSkeleton } from './clerk-form-skeleton';

export default function SignInForm() {
  return (
    <>
      <ClerkLoading>
        <ClerkFormSkeleton />
      </ClerkLoading>
      <ClerkLoaded>
        <div className="s-fade">
          <SignIn
            routing="path"
            path="/sign-in"
            oauthFlow="redirect"
            signUpUrl="/sign-up"
            waitlistUrl="/waitlist"
            fallbackRedirectUrl="/app"
            signUpFallbackRedirectUrl="/onboarding"
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

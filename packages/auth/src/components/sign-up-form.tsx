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
                cardBox: '!w-full !max-w-none',
                header: 'hidden',
                footer: 'hidden',
              },
            }}
          />
        </div>
      </ClerkLoaded>
    </>
  );
}

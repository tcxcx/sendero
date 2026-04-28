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
            fallbackRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/onboarding"
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

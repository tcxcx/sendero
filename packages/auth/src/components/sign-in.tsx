'use client';

import { SignIn } from '@clerk/nextjs';

export function SenderoSignIn() {
  return (
    <SignIn
      routing="path"
      path="/sign-in"
      signUpUrl="/sign-up"
      waitlistUrl="/waitlist"
      fallbackRedirectUrl="/app"
      appearance={{
        elements: {
          header: 'hidden',
          card: 'shadow-none border border-neutral-200',
        },
      }}
    />
  );
}

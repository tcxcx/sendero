'use client';

import { SignIn } from '@clerk/nextjs';

export function SenderoSignIn() {
  return (
    <SignIn
      appearance={{
        elements: {
          header: 'hidden',
          card: 'shadow-none border border-neutral-200',
        },
      }}
    />
  );
}

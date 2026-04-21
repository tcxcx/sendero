'use client';

import { SignUp } from '@clerk/nextjs';

export function SenderoSignUp() {
  return (
    <SignUp
      appearance={{
        elements: {
          header: 'hidden',
          card: 'shadow-none border border-neutral-200',
        },
      }}
    />
  );
}

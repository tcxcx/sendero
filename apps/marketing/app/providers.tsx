'use client';

import type { ReactNode } from 'react';

import { ClerkProvider } from '@clerk/nextjs';
import { senderoClerkAppearance } from '@sendero/ui/clerk-appearance';

export function Providers({
  children,
  allowedRedirectOrigins,
}: {
  children: ReactNode;
  allowedRedirectOrigins?: string[];
}) {
  return (
    <ClerkProvider
      appearance={senderoClerkAppearance}
      allowedRedirectOrigins={allowedRedirectOrigins}
    >
      {children}
    </ClerkProvider>
  );
}

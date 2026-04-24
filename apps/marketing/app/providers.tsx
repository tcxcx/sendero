'use client';

import type { ReactNode } from 'react';

import { ClerkProvider } from '@clerk/nextjs';

export function Providers({
  children,
  allowedRedirectOrigins,
}: {
  children: ReactNode;
  allowedRedirectOrigins?: string[];
}) {
  return <ClerkProvider allowedRedirectOrigins={allowedRedirectOrigins}>{children}</ClerkProvider>;
}

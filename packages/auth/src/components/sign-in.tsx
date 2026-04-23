'use client';

import dynamic from 'next/dynamic';

import { ClerkFormSkeleton } from './clerk-form-skeleton';

const SignInForm = dynamic(() => import('./sign-in-form'), {
  ssr: false,
  loading: () => <ClerkFormSkeleton />,
});

export function SenderoSignIn() {
  return <SignInForm />;
}

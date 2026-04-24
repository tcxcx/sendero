'use client';

import dynamic from 'next/dynamic';

import { ClerkFormSkeleton } from './clerk-form-skeleton';

const SignUpForm = dynamic(() => import('./sign-up-form'), {
  ssr: false,
  loading: () => <ClerkFormSkeleton />,
});

export function SenderoSignUp() {
  return <SignUpForm />;
}

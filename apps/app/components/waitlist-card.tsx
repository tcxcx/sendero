'use client';

import dynamic from 'next/dynamic';
import { ClerkFormSkeleton } from '@sendero/auth/components/clerk-form-skeleton';

import type { AuthCopy } from '@/lib/auth-copy';

const WaitlistForm = dynamic(() => import('./waitlist-form'), {
  ssr: false,
  loading: () => <ClerkFormSkeleton />,
});

type Props = { precheck: AuthCopy['waitlistPrecheck'] };

export function WaitlistCard({ precheck }: Props) {
  return <WaitlistForm precheck={precheck} />;
}

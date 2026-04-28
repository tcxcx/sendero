'use client';

import { ClerkLoaded, ClerkLoading, Waitlist } from '@clerk/nextjs';
import { ClerkFormSkeleton } from '@sendero/auth/components/clerk-form-skeleton';

import { WaitlistPrecheck } from '@/components/waitlist-precheck';
import type { AuthCopy } from '@/lib/auth-copy';

type Props = { precheck: AuthCopy['waitlistPrecheck'] };

export default function WaitlistForm({ precheck }: Props) {
  return (
    <>
      <ClerkLoading>
        <ClerkFormSkeleton />
      </ClerkLoading>
      <ClerkLoaded>
        <WaitlistPrecheck copy={precheck}>
          <div className="s-fade">
            <Waitlist
              signInUrl="/sign-in"
              afterJoinWaitlistUrl="/"
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
        </WaitlistPrecheck>
      </ClerkLoaded>
    </>
  );
}

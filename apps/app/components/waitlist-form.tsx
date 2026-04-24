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
                  header: 'hidden',
                  footer: 'hidden',
                  cardBox: '!w-full !max-w-none shadow-none rounded-none',
                  card: '!w-full shadow-none rounded-none border border-[var(--border)] bg-[var(--bg-elev)]',
                  formButtonPrimary:
                    'rounded-none bg-[var(--ink)] font-mono text-[11px] uppercase tracking-[0.12em] text-white shadow-none hover:bg-[var(--ink)]/90',
                  formFieldInput: 'rounded-none border-[var(--border)] shadow-none',
                },
              }}
            />
          </div>
        </WaitlistPrecheck>
      </ClerkLoaded>
    </>
  );
}

'use client';

import { ClerkLoaded, ClerkLoading, Waitlist } from '@clerk/nextjs';

export function WaitlistCard() {
  return (
    <>
      <ClerkLoading>
        <div
          aria-busy="true"
          aria-live="polite"
          className="w-full border border-[var(--border)] bg-[var(--bg-elev)] p-6"
        >
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
            Waitlist identity
          </p>
          <div className="mt-5 grid gap-3">
            <div className="h-11 animate-pulse border border-[var(--border)] bg-[var(--bg-sunk)]" />
            <div className="h-11 animate-pulse bg-[var(--ink)]" />
          </div>
        </div>
      </ClerkLoading>
      <ClerkLoaded>
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
                'rounded-none bg-[var(--ink)] font-mono text-[11px] uppercase tracking-[0.12em] shadow-none hover:bg-[var(--ink)]/90',
              formFieldInput: 'rounded-none border-[var(--border)] shadow-none',
            },
          }}
        />
      </ClerkLoaded>
    </>
  );
}

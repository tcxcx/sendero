'use client';

import { useUser, useWaitlist } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from '@sendero/ui/sonner';

import type { AuthCopy } from '@/lib/auth-copy';

const REDIRECT_MS = 900;

type PrecheckResponse =
  | { ok: true; scenario: 'none' }
  | { ok: true; scenario: 'waitlist_pending' }
  | { ok: true; scenario: 'invited'; invitePending?: boolean }
  | { ok: true; scenario: 'granted_completed' }
  | { ok: true; scenario: 'granted_allowlist' }
  | { ok: true; scenario: 'rejected' }
  | { error: string };

function redirectAfterToast(router: ReturnType<typeof useRouter>, path: string, replace = true) {
  window.setTimeout(() => {
    if (replace) router.replace(path);
    else router.push(path);
  }, REDIRECT_MS);
}

type Props = {
  copy: AuthCopy['waitlistPrecheck'];
  children: React.ReactNode;
};

export function WaitlistPrecheck({ copy, children }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useUser();
  const { waitlist, fetchStatus } = useWaitlist();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (ranRef.current) return;
    if (fetchStatus === 'fetching') return;

    if (isSignedIn) {
      ranRef.current = true;
      toast.info(copy.alreadySignedIn, { duration: 4500 });
      redirectAfterToast(router, '/dashboard');
      return;
    }

    if (waitlist.id) {
      ranRef.current = true;
      toast.info(copy.alreadyJoinedSession, { duration: 4500 });
      redirectAfterToast(router, '/sign-in');
      return;
    }

    const rawEmail = searchParams.get('email');
    if (!rawEmail) return;

    const emailAddress = decodeURIComponent(rawEmail).trim();
    if (!emailAddress.includes('@')) return;

    ranRef.current = true;

    void (async () => {
      try {
        const res = await fetch('/api/waitlist/precheck', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emailAddress }),
        });
        const body = (await res.json()) as PrecheckResponse;

        if (!res.ok || 'error' in body) {
          ranRef.current = false;
          return;
        }

        if (body.scenario === 'none') {
          ranRef.current = false;
          return;
        }

        if (body.scenario === 'waitlist_pending') {
          toast.info(copy.alreadyOnWaitlist, { duration: 5000 });
          redirectAfterToast(router, '/sign-in');
          return;
        }

        if (body.scenario === 'invited') {
          const msg = body.invitePending ? copy.invitedCheckEmail : copy.invited;
          toast.info(msg, { duration: 6500 });
          redirectAfterToast(router, '/sign-in');
          return;
        }

        if (body.scenario === 'granted_completed' || body.scenario === 'granted_allowlist') {
          const msg =
            body.scenario === 'granted_allowlist' ? copy.allowlistAccess : copy.grantedAccess;
          toast.info(msg, { duration: 5000 });
          redirectAfterToast(router, '/sign-in');
          return;
        }

        if (body.scenario === 'rejected') {
          toast.error(copy.requestNotApproved, { duration: 8000 });
        }
      } catch {
        ranRef.current = false;
      }
    })();
  }, [isLoaded, isSignedIn, waitlist.id, fetchStatus, searchParams, router, copy]);

  return <>{children}</>;
}

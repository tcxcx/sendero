'use client';

import { OrganizationList, useOrganization } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@sendero/ui/button';

const IS_DEV = process.env.NODE_ENV === 'development';
const STUCK_POLLS = 15;

type OrganizationMetadata = {
  onboardingComplete?: boolean;
  arcWalletAddress?: string;
};

export default function OnboardingPage() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const [polling, setPolling] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const pollIndex = useRef(0);
  const orgRef = useRef(organization);
  orgRef.current = organization;
  const pushedToApp = useRef(false);
  const loggedWaitForOrg = useRef<string | null>(null);

  const orgId = organization?.id;
  const onboardingComplete = Boolean(
    (organization?.publicMetadata as OrganizationMetadata | undefined)?.onboardingComplete
  );

  const runDevComplete = useCallback(async () => {
    setDevHint(null);
    setCompleting(true);
    try {
      const res = await fetch('/api/dev/complete-org-provisioning', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setDevHint(body.error ?? res.statusText ?? 'Request failed');
        if (IS_DEV) {
          console.error('[onboarding] dev complete-org-provisioning failed', res.status, body);
        }
        return;
      }
      if (IS_DEV) {
        console.log('[onboarding] dev provisioning completed', body);
      }
      await organization?.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDevHint(msg);
      if (IS_DEV) {
        console.error('[onboarding] dev complete-org-provisioning', e);
      }
    } finally {
      setCompleting(false);
    }
  }, [organization]);

  useEffect(() => {
    pushedToApp.current = false;
    loggedWaitForOrg.current = null;
  }, [orgId]);

  useEffect(() => {
    if (onboardingComplete) {
      setStuck(false);
    }
  }, [onboardingComplete]);

  useEffect(() => {
    if (!onboardingComplete || pushedToApp.current) {
      return;
    }
    pushedToApp.current = true;
    if (IS_DEV) {
      console.log('[onboarding] onboardingComplete → /app', orgRef.current?.publicMetadata);
    }
    router.push('/app');
  }, [onboardingComplete, router]);

  useEffect(() => {
    if (!orgId || onboardingComplete) {
      return;
    }

    if (IS_DEV && loggedWaitForOrg.current !== orgId) {
      loggedWaitForOrg.current = orgId;
      console.log('[onboarding] waiting for publicMetadata.onboardingComplete', {
        orgId,
        publicMetadata: orgRef.current?.publicMetadata,
      });
    }

    setPolling(true);
    pollIndex.current = 0;
    const interval = setInterval(() => {
      pollIndex.current += 1;
      const o = orgRef.current;
      if (IS_DEV) {
        console.log('[onboarding] poll', pollIndex.current, 'reload()…');
      }
      void o
        ?.reload()
        .then(() => {
          if (IS_DEV) {
            const meta = orgRef.current?.publicMetadata;
            console.log('[onboarding] after reload', {
              poll: pollIndex.current,
              publicMetadata: meta,
            });
          }
          if (pollIndex.current >= STUCK_POLLS) {
            setStuck(true);
            if (IS_DEV) {
              console.warn(
                '[onboarding] still no onboardingComplete after',
                STUCK_POLLS,
                'polls. Clerk webhooks do not reach localhost — use ngrok to /api/webhooks/clerk or the dev button below.'
              );
            }
          }
        })
        .catch(err => {
          if (IS_DEV) {
            console.error('[onboarding] organization.reload() failed', err);
          }
        });
    }, 2000);
    return () => clearInterval(interval);
  }, [orgId, onboardingComplete, router]);

  if (!isLoaded) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  if (!organization) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold mb-4">Welcome to Sendero</h1>
        <p className="text-neutral-600 mb-6">Create or select an organization to continue.</p>
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/onboarding"
          afterSelectOrganizationUrl="/onboarding"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold mb-4">Provisioning {organization.name}…</h1>
      <p className="text-neutral-600 mb-6">
        Setting up your Arc treasury wallet. This takes a few seconds.
      </p>
      <div className="animate-pulse text-xs font-mono text-neutral-500">
        polling {polling ? '●' : '○'}
      </div>

      {stuck && (
        <div className="mt-8 text-left text-sm text-neutral-700 space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
          <p className="font-medium text-amber-950">Still waiting? Common cause (local dev)</p>
          <p>
            <code className="text-xs">onboardingComplete</code> is set by the{' '}
            <code className="text-xs">organization.created</code> webhook, which calls Circle and
            then updates this org in Clerk. <strong>Clerk cannot POST to localhost</strong> unless
            you expose it (e.g. ngrok) and set the webhook URL in the Clerk dashboard to{' '}
            <code className="text-xs">https://&lt;tunnel&gt;/api/webhooks/clerk</code>.
          </p>
          <p className="text-xs text-neutral-600">
            Check the terminal running <code>next dev</code>: you should see{' '}
            <code className="text-xs">[webhooks/clerk] organization.created</code> when it works. No
            log usually means the webhook never arrived.
          </p>
        </div>
      )}

      {IS_DEV && (
        <div className="mt-6 space-y-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={completing}
            onClick={() => void runDevComplete()}
          >
            {completing ? 'Provisioning…' : 'Dev: run provisioning without webhook'}
          </Button>
          {devHint ? (
            <p className="text-xs text-red-600 font-mono text-left break-all">{devHint}</p>
          ) : null}
        </div>
      )}
    </main>
  );
}

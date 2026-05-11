'use client';

import { useOrganization } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ChainSelectScreen } from '@/components/onboarding/chain-select-screen';
import { ProvisioningWaitScreen } from '@/components/onboarding/provisioning-wait-screen';
import { WelcomeCardScreen } from '@/components/onboarding/welcome-card-screen';

const IS_DEV = process.env.NODE_ENV === 'development';
const STUCK_POLLS = 15;

type OrganizationMetadata = {
  onboardingComplete?: boolean;
  primaryChain?: 'arc' | 'sol';
  arcWalletAddress?: string;
  solTreasuryAddress?: string;
};

export default function OnboardingPage() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const [polling, setPolling] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  // Chain-select step state. `chosenChain` flips us out of the
  // ChainSelectScreen view into the ProvisioningWaitScreen view as soon
  // as the user clicks Deploy. Persists for the lifetime of the page;
  // a Clerk org-id change resets it (handled in the useEffect below).
  const [chosenChain, setChosenChain] = useState<'sol' | 'arc' | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const pollIndex = useRef(0);
  const orgRef = useRef(organization);
  orgRef.current = organization;
  const pushedToApp = useRef(false);
  const loggedWaitForOrg = useRef<string | null>(null);

  const orgId = organization?.id;
  const orgMetadata = organization?.publicMetadata as OrganizationMetadata | undefined;
  const onboardingComplete = Boolean(orgMetadata?.onboardingComplete);

  // Resolve which chain the wait screen should narrate. Three sources,
  // in priority order: explicit pick from this session, the Clerk org's
  // already-stamped chain (post-deploy), or the spec default ('sol').
  const activeChain: 'sol' | 'arc' = chosenChain ?? orgMetadata?.primaryChain ?? 'sol';

  const deployWithChain = useCallback(
    async (chain: 'sol' | 'arc') => {
      setDeployError(null);
      setCompleting(true);
      setChosenChain(chain);
      try {
        const res = await fetch('/api/dev/complete-org-provisioning', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ primaryChain: chain }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          ok?: boolean;
          stage?: string;
          message?: string;
          stack?: string;
        };
        if (!res.ok) {
          // Prefer the specific error from the route's catch block
          // (`message` + `stage`) over the generic `error` envelope.
          const detail = body.message ?? body.error ?? res.statusText ?? 'Request failed';
          const msg = body.stage ? `[${body.stage}] ${detail}` : detail;
          setDeployError(msg);
          // Drop back to the chain-select screen so the user can retry
          // without losing their pick.
          setChosenChain(null);
          if (IS_DEV) {
            console.error('[onboarding] deploy failed', res.status, body);
          }
          return;
        }
        if (IS_DEV) {
          console.log('[onboarding] deploy succeeded', body);
        }
        await organization?.reload();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setDeployError(msg);
        setChosenChain(null);
        if (IS_DEV) {
          console.error('[onboarding] deploy threw', e);
        }
      } finally {
        setCompleting(false);
      }
    },
    [organization]
  );

  // Legacy "Run provisioning without webhook" button on the wait screen.
  // Re-uses the deploy endpoint with the active chain — useful when the
  // first deploy attempt failed mid-flight and we want to retry without
  // going back to the chain-select step.
  const runDevComplete = useCallback(() => {
    setDevHint(null);
    void deployWithChain(activeChain).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      setDevHint(msg);
    });
  }, [activeChain, deployWithChain]);

  useEffect(() => {
    pushedToApp.current = false;
    loggedWaitForOrg.current = null;
    setChosenChain(null);
    setDeployError(null);
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
      console.log('[onboarding] onboardingComplete → /dashboard', orgRef.current?.publicMetadata);
    }
    router.push('/dashboard');
  }, [onboardingComplete, router]);

  useEffect(() => {
    // Only start the wait-for-webhook polling AFTER the user has picked
    // a chain (or the org metadata already has one stamped). Pre-pick
    // we're showing ChainSelectScreen and the polling loop would just
    // burn cycles waiting for a webhook that won't fire until deploy.
    if (!orgId || onboardingComplete) {
      return;
    }
    if (!chosenChain && !orgMetadata?.primaryChain) {
      setPolling(false);
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
  }, [orgId, onboardingComplete, chosenChain, orgMetadata?.primaryChain]);

  if (!isLoaded) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  if (!organization) {
    return <WelcomeCardScreen />;
  }

  // Chain-select step — shown after the Clerk org exists but before the
  // user has picked a chain (locally or via stamped publicMetadata).
  // Once they click Deploy, `chosenChain` flips and we render the wait
  // screen with the chosen chain's copy.
  if (!chosenChain && !orgMetadata?.primaryChain && !onboardingComplete) {
    return (
      <ChainSelectScreen
        organizationName={organization.name}
        defaultChain="sol"
        deploying={completing}
        deployError={deployError}
        onDeploy={deployWithChain}
      />
    );
  }

  return (
    <ProvisioningWaitScreen
      organizationName={organization.name}
      chain={activeChain}
      polling={polling}
      stuck={stuck}
      completing={completing}
      devHint={devHint}
      onRunDevComplete={runDevComplete}
    />
  );
}

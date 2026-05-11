'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useOrganization } from '@clerk/nextjs';

import { ChainSelectScreen } from '@/components/onboarding/chain-select-screen';
import {
  type ProvisioningProgressView,
  ProvisioningWaitScreen,
} from '@/components/onboarding/provisioning-wait-screen';
import { WelcomeCardScreen } from '@/components/onboarding/welcome-card-screen';

const IS_DEV = process.env.NODE_ENV === 'development';
// Number of /check-ready polls before the wait screen flips into "stuck"
// posture. 20 polls @ 1.5s = 30s. We only flip once `currentStage` has
// stopped advancing — a still-progressing run never looks "stuck".
const STUCK_POLLS = 20;
// Poll cadence while provisioning is in flight. Once a stage stamps
// `done` we still poll for the next stage's `running` stamp. After
// `currentStage === 'done'` we back off (the only remaining wait is
// Clerk's session-claim refresh, which happens on org.reload()).
const RUNNING_POLL_MS = 1500;
const SETTLED_POLL_MS = 5000;

type OrganizationMetadata = {
  onboardingComplete?: boolean;
  primaryChain?: 'arc' | 'sol';
  arcWalletAddress?: string;
  solTreasuryAddress?: string;
};

type CheckReadyResponse = {
  ready?: boolean;
  reason?: string;
  tenantId?: string;
  primaryChain?: 'arc' | 'sol';
  progress?: ProvisioningProgressView;
};

export default function OnboardingPage() {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const [stuck, setStuck] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [progress, setProgress] = useState<ProvisioningProgressView>(null);
  // Chain-select step state. `chosenChain` flips us out of the
  // ChainSelectScreen view into the ProvisioningWaitScreen view as soon
  // as the user clicks Deploy.
  const [chosenChain, setChosenChain] = useState<'sol' | 'arc' | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const lastStageRef = useRef<string | null>(null);
  const stuckCountRef = useRef(0);
  const orgRef = useRef(organization);
  orgRef.current = organization;
  const pushedToApp = useRef(false);
  const checkInFlight = useRef(false);

  const orgId = organization?.id;
  const orgMetadata = organization?.publicMetadata as OrganizationMetadata | undefined;
  const onboardingComplete = Boolean(orgMetadata?.onboardingComplete);

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
          progress?: ProvisioningProgressView;
        };
        if (!res.ok) {
          // Prefer the specific error from the route's catch block.
          const detail = body.message ?? body.error ?? res.statusText ?? 'Request failed';
          const msg = body.stage ? `[${body.stage}] ${detail}` : detail;
          setDeployError(msg);
          if (body.progress) setProgress(body.progress);
          if (IS_DEV) {
            console.error('[onboarding] deploy failed', res.status, body);
          }
          return;
        }
        if (IS_DEV) {
          console.log('[onboarding] deploy succeeded', body);
        }
        // Pre-fetch progress so the success state renders 3 green dots
        // before Clerk's session claim refresh completes.
        await refreshProgress();
        await organization?.reload();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setDeployError(msg);
        if (IS_DEV) {
          console.error('[onboarding] deploy threw', e);
        }
      } finally {
        setCompleting(false);
      }
    },
    [organization]
  );

  const refreshProgress = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      const res = await fetch('/api/onboarding/check-ready', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = (await res.json()) as CheckReadyResponse;
      if (data.progress) setProgress(data.progress);

      // Stuck detection: if currentStage hasn't advanced in STUCK_POLLS
      // ticks, surface the "taking longer" notice. Failed stages count
      // as stuck immediately so users see the retry button.
      const stageKey = data.progress?.currentStage ?? null;
      if (data.progress?.currentStage === 'failed') {
        setStuck(true);
      } else if (stageKey && stageKey === lastStageRef.current) {
        stuckCountRef.current += 1;
        if (stuckCountRef.current >= STUCK_POLLS) setStuck(true);
      } else {
        stuckCountRef.current = 0;
        setStuck(false);
      }
      lastStageRef.current = stageKey;

      if (data.ready && !pushedToApp.current) {
        pushedToApp.current = true;
        router.push('/dashboard');
        return;
      }

      // Inconsistent state: Clerk session JWT says onboardingComplete=true
      // but the DB-backed readiness check disagrees. Don't push — let the
      // user hit Retry, which kicks the dev endpoint and re-stamps.
      if (onboardingComplete && data.reason === 'no_wallet') {
        if (IS_DEV) {
          console.warn('[onboarding] clerk says complete but check-ready says no_wallet', data);
        }
      }
    } catch (err) {
      if (IS_DEV) console.warn('[onboarding] check-ready failed', err);
    } finally {
      checkInFlight.current = false;
    }
  }, [onboardingComplete, router]);

  // Legacy "Retry setup" button — re-runs deploy with the active chain.
  const runDevComplete = useCallback(() => {
    setDevHint(null);
    setStuck(false);
    stuckCountRef.current = 0;
    void deployWithChain(activeChain).catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      setDevHint(msg);
    });
  }, [activeChain, deployWithChain]);

  useEffect(() => {
    pushedToApp.current = false;
    lastStageRef.current = null;
    stuckCountRef.current = 0;
    setChosenChain(null);
    setDeployError(null);
    setProgress(null);
    setStuck(false);
  }, [orgId]);

  // Polling loop. Runs only after the user has picked a chain (or the
  // org already has one stamped from a prior attempt). Pre-pick we're
  // showing ChainSelectScreen.
  useEffect(() => {
    if (!orgId) return;
    if (!chosenChain && !orgMetadata?.primaryChain) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await refreshProgress();
      void orgRef.current?.reload().catch(() => {
        /* transient, retry on next tick */
      });
    };
    void tick();

    // Decide poll cadence based on the latest progress state.
    const cadence =
      progress?.currentStage === 'done' || progress?.currentStage === 'failed'
        ? SETTLED_POLL_MS
        : RUNNING_POLL_MS;

    interval = setInterval(() => {
      void tick();
    }, cadence);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [orgId, chosenChain, orgMetadata?.primaryChain, progress?.currentStage, refreshProgress]);

  if (!isLoaded) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  if (!organization) {
    return <WelcomeCardScreen />;
  }

  // Chain-select step — shown after the Clerk org exists but before the
  // user has picked a chain (locally or via stamped publicMetadata).
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
      progress={progress}
      polling
      stuck={stuck}
      completing={completing}
      devHint={devHint ?? deployError}
      onRunDevComplete={runDevComplete}
    />
  );
}

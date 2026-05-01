'use client';

import type { ReactNode } from 'react';

import Link from 'next/link';

import { Show } from '@clerk/nextjs';
import { Button } from '@sendero/ui/button';

import { AgentChip } from '@/components/agent-chip';
import { LiveblocksInboxButton } from '@/components/collaboration/liveblocks-inbox';
import { WalletDropdown } from '@/components/wallet-dropdown';
import { WorkspaceReputationChip } from '@/components/workspace-reputation-chip';

import { LanguageSelector } from '../language-selector';
import { OnboardingAlert } from './onboarding-alert';

type AppHeaderCopy = {
  signIn: string;
  getStarted: string;
};

const defaultCopy: AppHeaderCopy = {
  signIn: 'Sign in',
  getStarted: 'Get started',
};

export function AppHeader({
  copy = defaultCopy,
  locale = 'en-US',
  startSlot,
  liveblocksEnabled = false,
}: {
  copy?: AppHeaderCopy;
  locale?: string;
  startSlot?: ReactNode;
  liveblocksEnabled?: boolean;
}) {
  // Borderless: sits directly on the parchment field (DESIGN.md §19).
  // OnboardingAlert hangs below the header strip so signed-in users with
  // an unbound Arc wallet see a clear, dismissible CTA before they hit
  // the agent and start running into silent on-chain failures.
  return (
    <>
      <header className="flex h-14 min-w-0 items-start justify-between bg-transparent text-foreground px-4 pt-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {startSlot}
          <LanguageSelector canonicalPath="/dashboard" currentLocale={locale} compact />
        </div>
        <div className="flex items-center gap-2">
          <Show when="signed-in">
            {liveblocksEnabled ? <LiveblocksInboxButton /> : null}
            <AgentChip />
            <WorkspaceReputationChip />
            <WalletDropdown />
          </Show>
          <Show when="signed-out">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">{copy.signIn}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-up">{copy.getStarted}</Link>
            </Button>
          </Show>
        </div>
      </header>
      <Show when="signed-in">
        <OnboardingAlert />
      </Show>
    </>
  );
}

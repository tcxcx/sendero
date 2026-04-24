'use client';

/**
 * Slack BYO install card. If the tenant already has an install, show
 * it. Otherwise link to the corporate onboarding flow which builds the
 * Slack install URL via @sendero/slack.
 */

import { Button } from '@sendero/ui/button';
import Link from 'next/link';

interface SlackInstallView {
  id: string;
  teamName: string;
  enterpriseName: string | null;
  authedUserId: string;
  installedAt: Date;
}

export function SlackChannelCard({ installs }: { installs: SlackInstallView[] }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Slack</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Install Sendero in your Slack workspace for trip approvals, in-thread policy checks, and
            disruption nudges. Enterprise Grid installs cover every workspace under your org.
          </p>
        </div>
        <span
          className={
            installs.length > 0
              ? 'rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-700'
              : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground'
          }
        >
          {installs.length > 0
            ? `${installs.length} install${installs.length > 1 ? 's' : ''}`
            : 'not_connected'}
        </span>
      </div>

      {installs.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2 text-xs">
          {installs.map(install => (
            <li key={install.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">
                {install.enterpriseName ? `${install.enterpriseName} / ` : ''}
                {install.teamName}
              </span>
              <span className="text-muted-foreground">
                installed {install.installedAt.toLocaleDateString()} by {install.authedUserId}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <Button asChild>
          <Link href="/onboarding/corporate">
            {installs.length > 0 ? 'Install in another workspace' : 'Install Sendero in Slack'}
          </Link>
        </Button>
      </div>
    </div>
  );
}

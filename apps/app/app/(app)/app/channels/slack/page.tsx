import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';

export default function SlackChannelPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="Slack"
        description="Install the Sendero app in your Slack workspace for approvals, travel DMs, and policy-aware actions."
      />
      <p className="text-sm text-muted-foreground">
        Connect Slack for your org, then route employee trips into the same trip engine. Support
        conversations surface in{' '}
        <Link className="underline underline-offset-2" href="/app/inbox">
          Trip inboxes
        </Link>
        .
      </p>
      <Link
        className="text-sm font-medium text-primary underline underline-offset-2"
        href="/onboarding/corporate"
      >
        Open corporate onboarding
      </Link>
    </div>
  );
}

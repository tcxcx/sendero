import Link from 'next/link';

export default function SlackChannelPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Connect Slack for your org, then route employee trips into the same trip engine. Support
        conversations surface in{' '}
        <Link className="underline underline-offset-2" href="/dashboard/inbox">
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

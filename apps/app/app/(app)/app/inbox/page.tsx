import Link from 'next/link';

import { Button } from '@sendero/ui/button';

import { PageHeader } from '@/components/app-shell/page-header';

export default function InboxIndexPage() {
  return (
    <div className="flex min-h-[min(24rem,50vh)] flex-col gap-4 p-6">
      <PageHeader
        title="Trip inboxes"
        description="Pick a trip in the sidebar to open the support thread. Messages stay tied to the traveler’s channel and trip state."
      />
      <p className="max-w-xl text-sm text-muted-foreground">
        When a trip is selected, you’ll see conversation context and actions here. Connect WhatsApp
        or Slack from{' '}
        <Link href="/app/channels/whatsapp" className="underline underline-offset-2">
          Channels
        </Link>{' '}
        so inbox events map to the right place.
      </p>
      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href="/app/trips">Create or view trips</Link>
      </Button>
    </div>
  );
}

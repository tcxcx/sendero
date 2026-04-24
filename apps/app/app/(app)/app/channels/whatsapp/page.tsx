import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';

export default function WhatsAppChannelPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="WhatsApp"
        description="Connect a Meta Business number so travelers can run their journey in WhatsApp with your org branding."
      />
      <p className="text-sm text-muted-foreground">
        Full OAuth and template flows live in onboarding. This workspace route is the admin home for
        the channel; link travelers from prepaid trips and monitor threads in{' '}
        <Link className="underline underline-offset-2" href="/app/inbox">
          Trip inboxes
        </Link>
        .
      </p>
      <Link
        className="text-sm font-medium text-primary underline underline-offset-2"
        href="/onboarding/agency"
      >
        Open agency onboarding
      </Link>
    </div>
  );
}

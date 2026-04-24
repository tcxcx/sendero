/**
 * Settings → Channels — admin BYO onboarding surface.
 *
 * Renders a card per channel (WhatsApp via Kapso, Slack via OAuth) and
 * surfaces the connection status + last error. The heavy-lift flows
 * (setup link, OAuth) are handled by the respective API routes; this
 * page is read-only except for the "start onboarding" action.
 */

import { prisma } from '@sendero/database';
import Link from 'next/link';

import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';

import { WhatsAppChannelCard } from '@/components/settings/whatsapp-channel-card';
import { SlackChannelCard } from '@/components/settings/slack-channel-card';

export const dynamic = 'force-dynamic';

export default async function SettingsChannelsPage() {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();

  const [whatsappInstall, slackInstalls] = await Promise.all([
    prisma.whatsAppInstall.findUnique({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        status: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        businessDisplayName: true,
        lastHealthyAt: true,
        lastErrorMessage: true,
        metadata: true,
      },
    }),
    prisma.slackInstall.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        teamName: true,
        enterpriseName: true,
        authedUserId: true,
        installedAt: true,
      },
      orderBy: { installedAt: 'desc' },
    }),
  ]);

  const setupLink =
    (whatsappInstall?.metadata as { setupLink?: { url: string; expires_at: string } } | null)
      ?.setupLink ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground">
          Connect your WhatsApp Business number and Slack workspace. Trips route notifications to
          whichever channel the traveler prefers.
        </p>
      </div>

      <WhatsAppChannelCard install={whatsappInstall} setupLink={setupLink} />
      <SlackChannelCard installs={slackInstalls} />

      <p className="text-xs text-muted-foreground">
        Need per-trip overrides?{' '}
        <Link className="underline underline-offset-2" href="/dashboard/trips">
          Pick a channel on each trip
        </Link>
        .
      </p>
    </div>
  );
}

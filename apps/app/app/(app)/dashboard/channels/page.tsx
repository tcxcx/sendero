import Link from 'next/link';

import { prisma } from '@sendero/database';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';

import { getAppCopy } from '@/lib/app-copy';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function ChannelsPage() {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).dashboard;

  const status = await prisma.tenant.findUnique({
    where: { id: tenant.id },
    select: {
      whatsappInstall: { select: { status: true } },
      slackInstalls: { take: 1, select: { id: true } },
    },
  });

  const whatsappConnected = status?.whatsappInstall?.status === 'active';
  const slackConnected = (status?.slackInstalls.length ?? 0) > 0;

  const waCopy = copy.shortcuts.find(s => s.href === '/dashboard/channels/whatsapp');
  const slackCopy = copy.shortcuts.find(s => s.href === '/dashboard/channels/slack');

  return (
    <div className="flex w-full flex-col gap-6 px-2 pb-4 pt-0">
      <div className="flex flex-col items-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="max-w-md text-sm text-[color:var(--ink)]">
            Pick where Sendero should listen and reply. You can add both — each install is scoped to
            this workspace.
          </p>
        </div>

        <div className="flex flex-nowrap items-center justify-center gap-8">
          <BigChannelPill
            href="/dashboard/channels/whatsapp"
            brand="whatsapp"
            connected={whatsappConnected}
            description={waCopy?.description ?? 'Connect a Business number for white-label travel.'}
          />
          <BigChannelPill
            href="/dashboard/channels/slack"
            brand="slack"
            connected={slackConnected}
            description={slackCopy?.description ?? 'Install approvals and employee travel DMs.'}
          />
        </div>
      </div>
    </div>
  );
}

function BigChannelPill({
  href,
  brand,
  connected,
  description,
}: {
  href: string;
  brand: 'whatsapp' | 'slack';
  connected: boolean;
  description: string;
}) {
  const isWa = brand === 'whatsapp';
  const label = (connected ? 'Manage ' : 'Connect ') + (isWa ? 'WhatsApp' : 'Slack');
  const logoSrc = isWa ? '/brand/app-store/whatsapp.svg' : '/brand/app-store/slack.svg';
  const hoverChrome = isWa
    ? 'hover:border-[color:#25D366] hover:bg-[color:#E6FFDA]'
    : 'hover:border-[color:#611F69] hover:bg-[color:#F3E7F5]';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className={
            'group/qa inline-flex h-[286px] w-[286px] flex-col items-center justify-center gap-[20px] rounded-[32px] ' +
            'border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] ' +
            'bg-white text-[color:var(--text-dim)] shadow-[var(--shadow-md)] ' +
            'transition-colors duration-150 ' +
            hoverChrome
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- trademark-locked brand SVG, no next/image transcoding */}
          <img
            src={logoSrc}
            alt=""
            width={192}
            height={192}
            className="size-[192px] shrink-0"
            aria-hidden="true"
          />
          <span className="font-mono text-[22px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
            {connected ? 'Manage' : 'Connect'} {isWa ? 'WhatsApp' : 'Slack'}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" data-variant={brand} className="max-w-xs text-xs">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

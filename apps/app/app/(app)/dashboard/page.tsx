import Link from 'next/link';

import { prisma } from '@sendero/database';
import { Button } from '@sendero/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sendero/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';
import { ArrowRight, type LucideIcon, Sparkles } from 'lucide-react';

const CHANNEL_HREFS = {
  whatsapp: '/dashboard/channels/whatsapp',
  slack: '/dashboard/channels/slack',
} as const;

const NEUTRAL_SHORTCUT_ICONS: Record<string, LucideIcon> = {
  '/dashboard/integrations/mcp': Sparkles,
};

import { PageActions } from '@/components/dashboard/page-actions';
import { PlanTeaser } from '@/components/dashboard/plan-teaser';
import { StatCard } from '@/components/dashboard/stat-card';
import { TripStatusBadge } from '@/components/trips/trip-status-badge';
import { currentOrgPlanTier } from '@/lib/billing-plan';
import { getAppCopy } from '@/lib/app-copy';
import { formatDate, formatDecimalUsd, formatMicroUsd, stringFromJson } from '@/lib/format';
import { getRequestLocale } from '@/lib/request-locale';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function DashboardPage() {
  const { tenant } = await requireCurrentTenant();
  const locale = await getRequestLocale();
  const copy = getAppCopy(locale).dashboard;
  const planTier = await currentOrgPlanTier();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [activeTrips, recentTrips, unpaidInvoices, mtdSpend, channelStatus] = await Promise.all([
    prisma.trip.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
      },
    }),
    prisma.trip.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        totalUsdc: true,
        metadata: true,
        intent: true,
        createdAt: true,
      },
    }),
    prisma.invoice.aggregate({
      where: { tenantId: tenant.id, status: { in: ['issued', 'sent', 'viewed', 'overdue'] } },
      _sum: { totalMicro: true },
      _count: true,
    }),
    prisma.meterEvent.aggregate({
      where: { tenantId: tenant.id, status: 'paid', at: { gte: monthStart } },
      _sum: { priceMicroUsdc: true },
    }),
    // WhatsApp install is 1:1 with tenant; Slack allows multiple
    // workspaces (Enterprise Grid), so we only care if >=1 exists.
    prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: {
        whatsappInstall: { select: { status: true } },
        slackInstalls: { take: 1, select: { id: true } },
      },
    }),
  ]);

  const whatsappConnected = channelStatus?.whatsappInstall?.status === 'active';
  const slackConnected = (channelStatus?.slackInstalls.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageActions>
        <>
          {copy.shortcuts.map(s => {
            if (s.href === CHANNEL_HREFS.whatsapp) {
              return (
                <ChannelPill
                  key={s.href}
                  href={s.href}
                  brand="whatsapp"
                  connected={whatsappConnected}
                  description={s.description}
                />
              );
            }
            if (s.href === CHANNEL_HREFS.slack) {
              return (
                <ChannelPill
                  key={s.href}
                  href={s.href}
                  brand="slack"
                  connected={slackConnected}
                  description={s.description}
                />
              );
            }
            if (s.href === '/dashboard/integrations/mcp') {
              return (
                <ChannelPill key={s.href} href={s.href} brand="mcp" description={s.description} />
              );
            }
            const Icon = NEUTRAL_SHORTCUT_ICONS[s.href] ?? Sparkles;
            return (
              <Tooltip key={s.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={s.href}
                    aria-label={s.label}
                    className="sd-corner-hover group/qa inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-white text-[color:var(--text-dim)] shadow-[var(--shadow-xs)] transition-colors duration-150 hover:border-[color:var(--ink)] hover:bg-[color:var(--tint-vermillion-soft)] hover:text-[color:var(--ink)]"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" data-variant="ink" className="max-w-xs text-xs">
                  <div className="font-medium">{s.label}</div>
                  <div className="mt-0.5 text-[11px] opacity-85">{s.description}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="sd-corner-hover">
                <Button asChild variant="topography">
                  <Link href="/dashboard/console">
                    <span className="agent-console-cta__bg" aria-hidden="true" />
                    <span className="agent-console-cta__label">
                      {copy.agentConsole.cta}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </span>
                  </Link>
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" data-variant="ink" className="max-w-xs text-xs">
              <div className="font-medium">{copy.agentConsole.title}</div>
              <div className="mt-0.5 text-[11px] opacity-85">{copy.agentConsole.description}</div>
            </TooltipContent>
          </Tooltip>
          <div className="sd-corner-hover">
            <Button asChild>
              <Link href="/dashboard/trips?sheet=new">
                Create prepaid trip
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </>
      </PageActions>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={copy.stats.activeTrips}
          value={String(activeTrips)}
          href="/dashboard/trips"
        />
        <StatCard
          title={copy.stats.unpaidInvoices}
          value={formatMicroUsd(unpaidInvoices._sum.totalMicro ?? 0n)}
          description={copy.stats.openInvoices(unpaidInvoices._count)}
          href="/dashboard/billing/invoices"
        />
        <StatCard
          title={copy.stats.monthToDateSpend}
          value={formatMicroUsd(mtdSpend._sum.priceMicroUsdc ?? 0n)}
          href="/dashboard/spend"
        />
      </div>

      <PlanTeaser tier={planTier} />

      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] px-5 py-4 shadow-[var(--shadow-md)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          {copy.recentTrips.title}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.recentTrips.trip}</TableHead>
              <TableHead>{copy.recentTrips.status}</TableHead>
              <TableHead>{copy.recentTrips.budget}</TableHead>
              <TableHead>{copy.recentTrips.created}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTrips.map(trip => (
              <TableRow key={trip.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/trips/${trip.id}`}
                    className="font-medium hover:underline"
                  >
                    {stringFromJson(trip.metadata, 'tripSummary', trip.id.slice(0, 10))}
                  </Link>
                </TableCell>
                <TableCell>
                  <TripStatusBadge status={trip.status} />
                </TableCell>
                <TableCell style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatDecimalUsd(trip.totalUsdc)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(trip.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {recentTrips.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  {copy.recentTrips.empty}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

/**
 * Channel action chip. Geometry matches the neutral MCP chip
 * (`h-9 w-9` square) so the three header actions form a visually
 * consistent row; brand color lives on hover + tooltip only so the
 * dashboard's vermillion vocabulary keeps priority at rest.
 *
 * Logo SVGs live under /public/brand/app-store — trademark-locked,
 * rendered through plain `<img>` to bypass next/image SVG transcoding.
 *
 * Tooltip copy flips `Connect` → `Manage` based on the live install
 * status; chip chrome stays neutral either way. Hover fills with the
 * brand color (Mountain Meadow for WA, Honey Flower for Slack).
 */
function ChannelPill({
  href,
  brand,
  connected,
  description,
}: {
  href: string;
  brand: 'whatsapp' | 'slack' | 'mcp';
  /** Only meaningful for whatsapp / slack — drives the "Connect" vs "Manage" label. */
  connected?: boolean;
  description: string;
}) {
  const isWa = brand === 'whatsapp';
  const isSlack = brand === 'slack';
  const isMcp = brand === 'mcp';
  const label = isMcp
    ? 'MCP & API keys'
    : (connected ? 'Manage ' : 'Connect ') + (isWa ? 'WhatsApp' : 'Slack');
  const logoSrc = isWa
    ? '/brand/app-store/whatsapp.svg'
    : isSlack
      ? '/brand/app-store/slack.svg'
      : '/brand/app-store/mcp.svg';
  const hoverChrome = isWa
    ? 'hover:border-[color:#25D366] hover:bg-[color:#E6FFDA]'
    : isSlack
      ? 'hover:border-[color:#611F69] hover:bg-[color:#F3E7F5]'
      : 'hover:border-[color:var(--ink)] hover:bg-[color:var(--tint-vermillion-soft)]';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className={
            'sd-corner-hover group/qa inline-flex h-9 w-9 items-center justify-center rounded-md ' +
            'border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] ' +
            'bg-white text-[color:var(--text-dim)] shadow-[var(--shadow-xs)] ' +
            'transition-colors duration-150 ' +
            hoverChrome
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- trademark-locked brand SVG, no next/image transcoding */}
          <img
            src={logoSrc}
            alt=""
            width={isMcp ? 28 : 32}
            height={isMcp ? 28 : 32}
            className={isMcp ? 'size-7 shrink-0' : 'size-8 shrink-0'}
            aria-hidden="true"
          />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" data-variant="ink" className="max-w-xs text-xs">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function JourneyShortcut({
  href,
  label,
  description,
  openLabel,
}: {
  href: string;
  label: string;
  description: string;
  openLabel: string;
}) {
  return (
    <div className="flex min-h-40 flex-col justify-between rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
      <div>
        <h2 className="text-base font-medium tracking-normal text-foreground">{label}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button
        asChild
        size="sm"
        className="mt-4 justify-start !rounded-md bg-[color:var(--ink)] text-white hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)]"
      >
        <Link href={href}>{openLabel}</Link>
      </Button>
    </div>
  );
}

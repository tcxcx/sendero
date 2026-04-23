'use client';

/**
 * TripToolCard — tool-specific AI Elements artifact renderers for the
 * composed trip-assistance tools. Each card leads with the single most
 * important next action, keeps hierarchy tight for curbside/mobile
 * reading, and falls back gracefully when fields are missing.
 *
 * Motion rules (Emil-style):
 *   - fast property-specific transitions, ≤ 200ms
 *   - no scale-from-zero
 *   - subtle press feedback only on interactive controls
 *   - no decoration-for-decoration animation on repeated actions
 */

import type { ReactElement, ReactNode } from 'react';

import {
  AlertOctagonIcon,
  ArmchairIcon,
  BadgeCheckIcon,
  CarTaxiFrontIcon,
  ClockIcon,
  ExternalLinkIcon,
  HotelIcon,
  MapIcon,
  PlaneLandingIcon,
  ShieldAlertIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';

import {
  AncillaryPickerCard,
  type AncillaryPickerResult,
} from '@/components/ai-elements/ancillary-picker-card';

const cardShell =
  'rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3 transition-[background-color,border-color] duration-150 ease-out';

type SecondaryCta = { label: string; href?: string; offerId?: string };

interface SharePayload {
  title?: string;
  body?: string;
  bullets?: string[];
  primaryCta?: { label: string; href?: string; kind?: string; offerId?: string };
  secondaryCtas?: SecondaryCta[];
  mapLinks?: { googleMapsUrl?: string; appleMapsUrl?: string; staticMapUrl?: string };
}

interface MapBlockProps {
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
  alt: string;
}

function MapBlock({ staticMapUrl, googleMapsUrl, appleMapsUrl, alt }: MapBlockProps) {
  if (!staticMapUrl && !googleMapsUrl && !appleMapsUrl) return null;
  return (
    <div className="grid gap-3">
      {staticMapUrl ? (
        <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
          <img alt={alt} className="h-40 w-full object-cover" src={staticMapUrl} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {googleMapsUrl ? (
          <LinkChip
            href={googleMapsUrl}
            label="Google Maps"
            icon={<MapIcon className="size-3.5" />}
          />
        ) : null}
        {appleMapsUrl ? (
          <LinkChip
            href={appleMapsUrl}
            label="Apple Maps"
            icon={<MapIcon className="size-3.5" />}
          />
        ) : null}
      </div>
    </div>
  );
}

function LinkChip({
  href,
  label,
  icon,
  intent = 'default',
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  intent?: 'default' | 'primary';
}) {
  const base =
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors duration-150 ease-out';
  const tone =
    intent === 'primary'
      ? 'border-[color:var(--ink)] bg-[color:var(--ink)] text-[color:var(--panel)] hover:bg-[color:var(--text)]'
      : 'border-[color:var(--border)] text-[color:var(--ink)] hover:border-[color:var(--ink)]';
  return (
    <a className={`${base} ${tone}`} href={href} rel="noreferrer" target="_blank">
      {icon}
      {label}
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
      {children}
    </span>
  );
}

// ─── restaurant_route_card ───────────────────────────────────────────

interface RestaurantRouteCardResultShape {
  summary?: string;
  topPick?: {
    name: string;
    shortAddress?: string;
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    openNow?: boolean;
    googleMapsUrl?: string;
    appleMapsUrl?: string;
  };
  restaurants?: Array<{
    placeId: string;
    name: string;
    shortAddress?: string;
    formattedAddress?: string;
    rating?: number;
    priceLevel?: string;
    openNow?: boolean;
    googleMapsUrl?: string;
  }>;
  routeLinks?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
    mode?: string;
  };
  share?: SharePayload;
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function priceToTier(level?: string): string | null {
  if (!level) return null;
  if (level === 'PRICE_LEVEL_INEXPENSIVE') return '$';
  if (level === 'PRICE_LEVEL_MODERATE') return '$$';
  if (level === 'PRICE_LEVEL_EXPENSIVE') return '$$$';
  if (level === 'PRICE_LEVEL_VERY_EXPENSIVE') return '$$$$';
  return null;
}

function RestaurantRouteCardView({ data }: { data: RestaurantRouteCardResultShape }) {
  const top = data.topPick;
  const rest = (data.restaurants ?? []).filter(r => r.name !== top?.name).slice(0, 2);
  const primaryHref = data.routeLinks?.googleMapsUrl ?? top?.googleMapsUrl ?? data.googleMapsUrl;
  return (
    <div className="grid gap-3">
      {top ? (
        <div className={cardShell}>
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
              <UtensilsCrossedIcon className="size-4" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-[color:var(--ink)]">{top.name}</span>
                {top.rating ? (
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {top.rating.toFixed(1)}★
                    {top.userRatingCount ? ` · ${top.userRatingCount.toLocaleString()}` : ''}
                  </span>
                ) : null}
                {priceToTier(top.priceLevel) ? (
                  <span className="font-mono text-[11px] text-[color:var(--text-dim)]">
                    {priceToTier(top.priceLevel)}
                  </span>
                ) : null}
                {top.openNow ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent-green)]">
                    <span className="size-1.5 rounded-full bg-[color:var(--accent-green)]" /> open
                  </span>
                ) : null}
              </div>
              {top.shortAddress || top.formattedAddress ? (
                <div className="mt-1 text-xs text-[color:var(--text-dim)]">
                  {top.shortAddress || top.formattedAddress}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <MapBlock
        staticMapUrl={data.routeLinks?.staticMapUrl ?? data.staticMapUrl}
        googleMapsUrl={primaryHref}
        appleMapsUrl={data.routeLinks?.appleMapsUrl ?? top?.appleMapsUrl ?? data.appleMapsUrl}
        alt={top ? `Route to ${top.name}` : 'Restaurant preview map'}
      />
      {rest.length > 0 ? (
        <div className="grid gap-2">
          <SectionLabel>Also shortlisted</SectionLabel>
          {rest.map(r => (
            <a
              key={r.placeId || r.name}
              href={r.googleMapsUrl}
              rel="noreferrer"
              target="_blank"
              className={`${cardShell} block hover:border-[color:var(--ink)]`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-sm text-[color:var(--ink)]">{r.name}</div>
                  {r.shortAddress ? (
                    <div className="mt-0.5 text-xs text-[color:var(--text-dim)]">
                      {r.shortAddress}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-[color:var(--text-dim)]">
                  {r.rating ? <span>{r.rating.toFixed(1)}★</span> : null}
                  {priceToTier(r.priceLevel) ? <span>{priceToTier(r.priceLevel)}</span> : null}
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── airport_transfer_coordinator ────────────────────────────────────

interface AirportTransferResult {
  summary?: string;
  pickupPlan?: {
    meetingPoint: string;
    meetingPointDetail: string;
    primaryMode: string;
    arrivalHint?: string;
    travelerSignText: string;
  };
  backupTransport?: Array<{ mode: string; label: string; note: string; href?: string }>;
  routeLinks?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
    from?: string;
    to?: string;
  };
  destination?: { label: string; formattedAddress?: string; verified?: boolean };
  safety?: { riskLevel?: string; summary?: string };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function riskColor(level?: string): string {
  if (level === 'high') return 'var(--accent-rose)';
  if (level === 'moderate') return 'var(--accent-orange, #d9480f)';
  return 'var(--accent-green)';
}

function AirportTransferView({ data }: { data: AirportTransferResult }) {
  const pickup = data.pickupPlan;
  const backup = (data.backupTransport ?? []).slice(0, 3);
  return (
    <div className="grid gap-3">
      {pickup ? (
        <div className={cardShell}>
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
              <CarTaxiFrontIcon className="size-4" />
            </div>
            <div className="flex-1 grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <SectionLabel>Meet at</SectionLabel>
                <span className="font-medium text-sm text-[color:var(--ink)]">
                  {pickup.meetingPoint}
                </span>
              </div>
              <div className="text-xs text-[color:var(--text-dim)]">
                {pickup.meetingPointDetail}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SectionLabel>Sign</SectionLabel>
                <span className="font-mono text-[11px] text-[color:var(--ink)]">
                  {pickup.travelerSignText}
                </span>
              </div>
              {pickup.arrivalHint ? (
                <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                  {pickup.arrivalHint}
                </div>
              ) : null}
            </div>
            {data.safety?.riskLevel ? (
              <span
                className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                style={{ color: riskColor(data.safety.riskLevel) }}
              >
                {data.safety.riskLevel}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <MapBlock
        staticMapUrl={data.routeLinks?.staticMapUrl ?? data.staticMapUrl}
        googleMapsUrl={data.routeLinks?.googleMapsUrl ?? data.googleMapsUrl}
        appleMapsUrl={data.routeLinks?.appleMapsUrl ?? data.appleMapsUrl}
        alt={
          data.routeLinks
            ? `${data.routeLinks.from} → ${data.routeLinks.to}`
            : 'Airport transfer route'
        }
      />
      {backup.length > 0 ? (
        <div className="grid gap-2">
          <SectionLabel>Backup transport</SectionLabel>
          <div className="grid gap-2">
            {backup.map(b => (
              <div key={b.label} className={`${cardShell} grid gap-1`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-[color:var(--ink)]">{b.label}</span>
                  {b.href ? <LinkChip href={b.href} label="open" /> : null}
                </div>
                <div className="text-xs text-[color:var(--text-dim)]">{b.note}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── airport_arrival_playbook ────────────────────────────────────────

interface ArrivalPlaybookResult {
  summary?: string;
  headline?: string;
  arrivalSteps?: Array<{ id: string; label: string; detail: string; href?: string }>;
  contacts?: Array<{ label: string; value: string; href?: string }>;
  routeLinks?: { googleMapsUrl: string; appleMapsUrl: string; staticMapUrl?: string };
  timezone?: { timeZoneName?: string; timeZoneId?: string; localTimeIso?: string };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function ArrivalPlaybookView({ data }: { data: ArrivalPlaybookResult }) {
  const steps = data.arrivalSteps ?? [];
  return (
    <div className="grid gap-3">
      <div className={cardShell}>
        <div className="flex items-start gap-3">
          <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
            <PlaneLandingIcon className="size-4" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm text-[color:var(--ink)]">
              {data.headline ?? 'Arrival plan'}
            </div>
            {data.timezone?.timeZoneName ? (
              <div className="mt-1 font-mono text-[11px] text-[color:var(--text-dim)]">
                {data.timezone.timeZoneName}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {steps.length > 0 ? (
        <ol className="grid gap-2">
          {steps.map((s, i) => (
            <li key={s.id} className={`${cardShell} grid gap-1`}>
              <div className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full border border-[color:var(--border)] font-mono text-[11px] text-[color:var(--ink)]">
                  {i + 1}
                </span>
                <span className="font-medium text-sm text-[color:var(--ink)]">{s.label}</span>
              </div>
              <div className="pl-9 text-xs text-[color:var(--text-dim)]">{s.detail}</div>
              {s.href ? (
                <div className="pl-9">
                  <LinkChip href={s.href} label="open" icon={<MapIcon className="size-3.5" />} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <MapBlock
        staticMapUrl={data.routeLinks?.staticMapUrl ?? data.staticMapUrl}
        googleMapsUrl={data.routeLinks?.googleMapsUrl ?? data.googleMapsUrl}
        appleMapsUrl={data.routeLinks?.appleMapsUrl ?? data.appleMapsUrl}
        alt="Arrival route preview"
      />
    </div>
  );
}

// ─── trip_checkin_reminder ───────────────────────────────────────────

interface CheckinReminderResult {
  summary?: string;
  headline?: string;
  checkInWindow?: {
    opensAtIso: string;
    closesAtIso: string;
    gateCloseMinutesBeforeDeparture: number;
  };
  airportTransitNote?: string;
  nextAction?: { label: string; kind: 'check_in' | 'leave_for_airport' | 'reply'; href?: string };
  route?: {
    googleMapsUrl: string;
    appleMapsUrl: string;
    staticMapUrl?: string;
    leaveByIso: string;
  };
  timezone?: { timeZoneName?: string; timeZoneId?: string };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function fmtIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function CheckinReminderView({ data }: { data: CheckinReminderResult }) {
  const w = data.checkInWindow;
  const tz = data.timezone?.timeZoneName;
  return (
    <div className="grid gap-3">
      <div className={cardShell}>
        <div className="flex items-start gap-3">
          <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
            <ClockIcon className="size-4" />
          </div>
          <div className="flex-1 grid gap-1.5">
            <div className="font-medium text-sm text-[color:var(--ink)]">
              {data.headline ?? 'Check-in reminder'}
            </div>
            {w ? (
              <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                {fmtIso(w.opensAtIso)} → {fmtIso(w.closesAtIso)}
                {tz ? ` · ${tz}` : ''}
              </div>
            ) : null}
            {data.airportTransitNote ? (
              <div className="text-xs text-[color:var(--text-dim)]">{data.airportTransitNote}</div>
            ) : null}
            {data.nextAction ? (
              <div>
                {data.nextAction.href ? (
                  <LinkChip
                    href={data.nextAction.href}
                    label={data.nextAction.label}
                    intent={data.nextAction.kind === 'leave_for_airport' ? 'primary' : 'default'}
                  />
                ) : (
                  <span className="inline-flex items-center rounded-full border border-[color:var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)]">
                    {data.nextAction.label}
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {w ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
              gate -{w.gateCloseMinutesBeforeDeparture}m
            </span>
          ) : null}
        </div>
      </div>
      {data.route ? (
        <MapBlock
          staticMapUrl={data.route.staticMapUrl ?? data.staticMapUrl}
          googleMapsUrl={data.route.googleMapsUrl ?? data.googleMapsUrl}
          appleMapsUrl={data.route.appleMapsUrl ?? data.appleMapsUrl}
          alt="Route to airport"
        />
      ) : null}
    </div>
  );
}

// ─── trip_delay_replanner ────────────────────────────────────────────

interface DelayReplannerResult {
  summary?: string;
  headline?: string;
  disruption?: { canonicalLabel: string; kind: string; reason?: string };
  rebookOptions?: Array<{
    offerId: string;
    price: string;
    currency: string;
    segmentsSummary: string;
    departureIso?: string;
    arrivalIso?: string;
    carrier?: string;
    stops?: number;
    selectable: boolean;
  }>;
  recommendedRebook?: {
    offerId: string;
    price: string;
    currency: string;
    segmentsSummary: string;
    departureIso?: string;
    carrier?: string;
  };
  hotelFallback?: {
    name: string;
    rate?: string;
    currency?: string;
    neighborhood?: string;
    photo?: string;
  };
  routeLinks?: { googleMapsUrl: string; appleMapsUrl: string; staticMapUrl?: string };
  staticMapUrl?: string;
  googleMapsUrl?: string;
  appleMapsUrl?: string;
}

function DelayReplannerView({ data }: { data: DelayReplannerResult }) {
  const options = data.rebookOptions ?? [];
  const top = data.recommendedRebook ?? options.find(o => o.selectable);
  const rest = options.filter(o => o.offerId !== top?.offerId).slice(0, 2);
  return (
    <div className="grid gap-3">
      <div className={cardShell}>
        <div className="flex items-start gap-3">
          <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--accent-rose)]">
            <AlertOctagonIcon className="size-4" />
          </div>
          <div className="flex-1 grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--accent-rose)]">
                {data.disruption?.canonicalLabel ?? 'Disruption'}
              </span>
              <span className="font-medium text-sm text-[color:var(--ink)]">{data.headline}</span>
            </div>
            {data.disruption?.reason ? (
              <div className="text-xs text-[color:var(--text-dim)]">{data.disruption.reason}</div>
            ) : null}
          </div>
        </div>
      </div>
      {top ? (
        <div className={cardShell}>
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--accent-green)]">
              <BadgeCheckIcon className="size-4" />
            </div>
            <div className="flex-1 grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <SectionLabel>Best rebook</SectionLabel>
                <span className="font-medium text-sm text-[color:var(--ink)]">
                  {top.segmentsSummary}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                {top.price} {top.currency}
                {top.departureIso ? ` · ${top.departureIso.slice(0, 16).replace('T', ' ')}` : ''}
                {top.carrier ? ` · ${top.carrier}` : ''}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={cardShell}>
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--accent-rose)]">
              <ShieldAlertIcon className="size-4" />
            </div>
            <div className="flex-1 text-xs text-[color:var(--text-dim)]">
              No self-serve rebook matched. A Sendero agent will take it from here.
            </div>
          </div>
        </div>
      )}
      {rest.length > 0 ? (
        <div className="grid gap-2">
          <SectionLabel>Alternatives</SectionLabel>
          {rest.map(o => (
            <div key={o.offerId} className={`${cardShell} flex items-center justify-between gap-3`}>
              <div>
                <div className="font-medium text-sm text-[color:var(--ink)]">
                  {o.segmentsSummary}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[color:var(--text-dim)]">
                  {o.price} {o.currency}
                  {o.departureIso ? ` · ${o.departureIso.slice(0, 16).replace('T', ' ')}` : ''}
                </div>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
                {typeof o.stops === 'number' ? `${o.stops} stops` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {data.hotelFallback ? (
        <div className={cardShell}>
          <div className="flex items-start gap-3">
            <div className="mt-1 grid size-8 place-items-center rounded-lg bg-[color:var(--bg-soft)] text-[color:var(--ink)]">
              <HotelIcon className="size-4" />
            </div>
            <div className="flex-1 grid gap-0.5">
              <SectionLabel>Overnight fallback</SectionLabel>
              <div className="font-medium text-sm text-[color:var(--ink)]">
                {data.hotelFallback.name}
              </div>
              <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
                {data.hotelFallback.neighborhood ?? ''}
                {data.hotelFallback.rate
                  ? ` · ${data.hotelFallback.rate} ${data.hotelFallback.currency ?? ''}`
                  : ''}
              </div>
            </div>
            <ArmchairIcon className="size-4 text-[color:var(--text-faint)]" />
          </div>
        </div>
      ) : null}
      <MapBlock
        staticMapUrl={data.routeLinks?.staticMapUrl ?? data.staticMapUrl}
        googleMapsUrl={data.routeLinks?.googleMapsUrl ?? data.googleMapsUrl}
        appleMapsUrl={data.routeLinks?.appleMapsUrl ?? data.appleMapsUrl}
        alt="Airport to hotel preview"
      />
    </div>
  );
}

// ─── Dispatcher ──────────────────────────────────────────────────────

export function TripToolCard({
  toolName,
  result,
}: {
  toolName: string;
  result: unknown;
}): ReactElement | null {
  if (!result || typeof result !== 'object') return null;
  const data = result as Record<string, unknown>;
  if (toolName === 'restaurant_route_card') {
    return <RestaurantRouteCardView data={data as RestaurantRouteCardResultShape} />;
  }
  if (toolName === 'airport_transfer_coordinator') {
    return <AirportTransferView data={data as AirportTransferResult} />;
  }
  if (toolName === 'airport_arrival_playbook') {
    return <ArrivalPlaybookView data={data as ArrivalPlaybookResult} />;
  }
  if (toolName === 'trip_checkin_reminder') {
    return <CheckinReminderView data={data as CheckinReminderResult} />;
  }
  if (toolName === 'trip_delay_replanner') {
    return <DelayReplannerView data={data as DelayReplannerResult} />;
  }
  if (toolName === 'list_flight_ancillaries') {
    return <AncillaryPickerCard data={data as AncillaryPickerResult} />;
  }
  return null;
}

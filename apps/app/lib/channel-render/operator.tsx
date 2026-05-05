/**
 * Operator-side renderer for `ChannelMessage`.
 *
 * Uses the AI Elements primitives Sendero already has installed under
 * apps/app/components/ai-elements. Returns a single React element per
 * canonical message kind, exhaustively switching on the discriminator
 * so the compiler enforces parity when new kinds land.
 *
 * Composition contract: this renderer ONLY emits the inner content of
 * a Message. Wrapping in a <Message from={role}>...</Message> is the
 * caller's job (the chat surface owns the role mapping).
 */

import type { JSX } from 'react';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';

// `@/components/ai-elements/confirmation` and `@/components/ai-elements/task`
// are dropped in alongside but not imported here yet. See the JSDoc on
// ApprovalCard for the prop-shape mismatch that's blocking direct adoption
// of Confirmation, and the `tool_invocation` case below for why Task is
// held until the canonical shape exposes a multi-step orchestration kind.

import { StayRatePickerCard } from '@/components/ai-elements/stay-rate-picker-card';
import { StayQuoteReviewCard } from '@/components/ai-elements/stay-quote-card';
import { StayBookingConfirmationCard } from '@/components/ai-elements/stay-booking-confirmation-card';

import { DEVICE_ORDER, INSTALL_INSTRUCTIONS } from './install-instructions';
import type {
  ChannelMessage,
  ChannelCta,
  ChannelMessageEsimActivation,
  ChannelMessageSeatPicker,
  ChannelMessageAncillaryPicker,
  ChannelMessageStayRatePicker,
  ChannelMessageStayQuoteReview,
  ChannelMessageStayBookingConfirmation,
  ChannelMessageTripBrief,
} from './types';

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind');
}

/**
 * DESIGN-compliant bubble shell for any text-y MessageContent emission:
 * topography SVG bg over parchment, dim hairline border, dim ink text,
 * no shadow (DESIGN.md: "no panel has both shadow and border"). Applied
 * via className override; the AI Elements `MessageContent` already
 * group-aligns user msgs to the right via `.is-user` group selector.
 */
const BUBBLE_CLASSNAME = [
  'rounded-lg border border-[color:var(--hairline-color-soft)]',
  "bg-[color:var(--surface-raised)] bg-[url('/patterns/topography.svg')]",
  'bg-[length:240px] bg-no-repeat px-4 py-3',
  'text-[color:color-mix(in_oklab,var(--ink)_72%,transparent)]',
  'group-[.is-user]:!bg-[color:var(--surface-raised)]',
  'group-[.is-user]:!text-[color:color-mix(in_oklab,var(--ink)_72%,transparent)]',
].join(' ');
const BUBBLE_STYLE = { backgroundBlendMode: 'multiply' as const };

/** Render the inner content for a single canonical message. */
export function renderForOperator(msg: ChannelMessage): JSX.Element {
  switch (msg.kind) {
    case 'text':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <MessageResponse>{msg.content}</MessageResponse>
        </MessageContent>
      );

    case 'card':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <CardBlock
            title={msg.title}
            body={msg.body}
            bullets={msg.bullets}
            imageUrl={msg.imageUrl}
            ctas={msg.ctas}
          />
        </MessageContent>
      );

    case 'tool_invocation':
      // Single Tool block per call — input + output (or error) collapsed
      // inside the same ToolContent. Output renders only when status is
      // 'done' AND the converter passed a `result`. Tools that want a
      // separate share-card view emit a distinct `tool_result` instead.
      return (
        <Tool>
          <ToolHeader
            type={`tool-${msg.toolName}`}
            state={
              msg.status === 'pending'
                ? 'input-streaming'
                : msg.status === 'streaming'
                  ? 'input-streaming'
                  : msg.status === 'error'
                    ? 'output-error'
                    : 'output-available'
            }
          />
          <ToolContent>
            <ToolInput input={msg.input} />
            {msg.errorMessage ? (
              <ToolOutput output={null} errorText={msg.errorMessage} />
            ) : msg.status === 'done' && msg.result !== undefined ? (
              <ToolOutput
                output={<pre className="overflow-x-auto text-xs">{stringify(msg.result)}</pre>}
                errorText={undefined}
              />
            ) : null}
          </ToolContent>
        </Tool>
      );

    case 'tool_result':
      return (
        <Tool defaultOpen>
          <ToolHeader type={`tool-${msg.toolName}`} state="output-available" />
          <ToolContent>
            <ToolOutput
              output={
                msg.share ? (
                  <CardBlock
                    title={msg.share.title}
                    body={msg.share.body}
                    bullets={msg.share.bullets}
                    imageUrl={msg.share.imageUrl}
                    ctas={[
                      ...(msg.share.primaryCta ? [msg.share.primaryCta] : []),
                      ...(msg.share.secondaryCtas ?? []),
                    ]}
                  />
                ) : (
                  <pre className="overflow-x-auto text-xs">{stringify(msg.result)}</pre>
                )
              }
              errorText={undefined}
            />
          </ToolContent>
        </Tool>
      );

    case 'approval_request':
      return (
        <MessageContent>
          <ApprovalCard
            travelerName={msg.subject.travelerName}
            route={msg.subject.route}
            amountUsd={msg.subject.amountUsd}
            expiresAt={msg.subject.expiresAt}
            reason={msg.subject.reason}
            reviewUrl={msg.reviewUrl}
          />
        </MessageContent>
      );

    case 'reasoning':
      return (
        <Reasoning defaultOpen={!msg.collapsedByDefault} duration={msg.durationMs}>
          <ReasoningTrigger />
          <ReasoningContent>{msg.content}</ReasoningContent>
        </Reasoning>
      );

    case 'sources':
      if (msg.items.length === 0) {
        return <MessageContent>{null}</MessageContent>;
      }
      return (
        <MessageContent>
          <Sources>
            <SourcesTrigger count={msg.items.length} />
            <SourcesContent>
              {msg.items.map(s => (
                <Source key={s.url} href={s.url} title={s.title} />
              ))}
            </SourcesContent>
          </Sources>
        </MessageContent>
      );

    case 'esim_activation':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <EsimActivationCard {...msg} />
        </MessageContent>
      );

    case 'seat_picker':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <SeatPickerCard {...msg} />
        </MessageContent>
      );

    case 'ancillary_picker':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <AncillaryPickerCard {...msg} />
        </MessageContent>
      );

    case 'trip_brief':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <TripBriefCard {...msg} />
        </MessageContent>
      );

    case 'stay_rate_picker':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <StayRatePickerView msg={msg} />
        </MessageContent>
      );

    case 'stay_quote_review':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <StayQuoteReviewView msg={msg} />
        </MessageContent>
      );

    case 'stay_booking_confirmation':
      return (
        <MessageContent className={BUBBLE_CLASSNAME} style={BUBBLE_STYLE}>
          <StayBookingConfirmationView msg={msg} />
        </MessageContent>
      );

    default:
      return exhaustive(msg);
  }
}

function StayRatePickerView({ msg }: { msg: ChannelMessageStayRatePicker }) {
  return (
    <StayRatePickerCard
      data={{
        searchResultId: msg.searchResultId,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        rooms: msg.rooms,
        guests: msg.guests,
        rates: msg.rates.map(r => ({
          rateId: r.rateId,
          roomName: r.roomName,
          paymentType: r.paymentType,
          availablePaymentMethods: r.availablePaymentMethods,
          refundable: r.refundable,
          boardType: r.boardType ?? null,
          billing: r.billing,
        })),
        business: msg.business,
      }}
    />
  );
}

function StayQuoteReviewView({ msg }: { msg: ChannelMessageStayQuoteReview }) {
  return (
    <StayQuoteReviewCard
      data={{
        quoteId: msg.quoteId,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        nights: msg.nights,
        rooms: msg.rooms,
        guests: msg.guests,
        roomName: msg.roomName,
        paymentType: msg.paymentType,
        billing: msg.billing,
        cancellationTimeline: msg.cancellationTimeline,
        conditions: msg.conditions,
        supportedLoyaltyProgrammeName: msg.supportedLoyaltyProgrammeName,
        business: msg.business,
      }}
    />
  );
}

function StayBookingConfirmationView({ msg }: { msg: ChannelMessageStayBookingConfirmation }) {
  return (
    <StayBookingConfirmationCard
      data={{
        bookingId: msg.bookingId,
        reference: msg.reference,
        confirmedAt: msg.confirmedAt,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        nights: msg.nights,
        rooms: msg.rooms,
        guests: msg.guests,
        roomName: msg.roomName,
        paymentType: null,
        billing: msg.billing,
        cancellationTimeline: msg.cancellationTimeline,
        conditions: msg.conditions,
        supportedLoyaltyProgrammeName: msg.supportedLoyaltyProgrammeName,
        business: msg.business,
      }}
    />
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface CardBlockProps {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

function CardBlock({ title, body, bullets, imageUrl, ctas }: CardBlockProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="mb-1 max-h-48 w-full rounded-sm object-cover" />
      ) : null}
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="text-sm text-foreground">{body}</div>
      {bullets && bullets.length > 0 ? (
        <ul className="ml-4 list-disc text-xs text-muted-foreground">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {ctas && ctas.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {ctas.map((cta, i) => (
            <CtaButton key={i} cta={cta} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CtaButton({ cta }: { cta: ChannelCta }) {
  const isPrimary = cta.emphasis !== 'secondary';
  const cls = isPrimary
    ? 'rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90'
    : 'rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-[color:var(--ink)] hover:text-foreground';
  if (cta.kind === 'open_link' && cta.href) {
    return (
      <a className={cls} href={cta.href} target="_blank" rel="noreferrer">
        {cta.label}
      </a>
    );
  }
  return (
    <button type="button" className={cls} data-cta-kind={cta.kind} data-cta-value={cta.value ?? ''}>
      {cta.label}
    </button>
  );
}

/**
 * Operator-side eSIM activation card. The whole content stack lives in
 * one bubble so the operator preview matches what the traveler sees on
 * Slack/web/WhatsApp:
 *   QR image (left) + plan + LPA install URL + per-device steps.
 *
 * The QR is the source-of-truth artifact — any device can scan it.
 * The "Install on iPhone" anchor uses the install URL (not the LPA:
 * scheme) so the operator can click and preview the install page in
 * a regular browser; iOS travelers tapping in WhatsApp/web get the
 * auto-redirect inside the install page.
 */
function EsimActivationCard(props: ChannelMessageEsimActivation) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Trip eSIM ready
      </div>
      <div className="flex gap-3">
        <img
          src={props.qrUrl}
          alt={`Install QR for ${props.planLabel}`}
          width={160}
          height={160}
          className="h-40 w-40 shrink-0 rounded-sm border border-border bg-white object-contain p-1"
        />
        <div className="flex min-w-0 flex-col gap-1.5 text-sm">
          <div className="font-medium text-foreground">{props.planLabel}</div>
          <div className="text-xs text-muted-foreground">
            {(props.dataMb / 1024).toFixed(1)} GB · {props.validityDays} days ·{' '}
            {props.countries.join(', ')}
          </div>
          {props.priceLine ? (
            <div className="font-mono text-[11px] text-muted-foreground">{props.priceLine}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <a
              href={props.installUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
            >
              📱 Install on iPhone
            </a>
            <a
              href={`${props.installUrl}#instructions`}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-[color:var(--ink)] hover:text-foreground"
            >
              Other devices
            </a>
          </div>
        </div>
      </div>
      <details className="rounded-sm border border-border bg-background/50 p-2">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Install instructions per device
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {DEVICE_ORDER.map(device => {
            const instr = INSTALL_INSTRUCTIONS[device];
            return (
              <div key={device} className="text-xs">
                <div className="font-medium text-foreground">
                  {instr.label}
                  {instr.subLabel ? (
                    <span className="ml-1 text-muted-foreground">· {instr.subLabel}</span>
                  ) : null}
                </div>
                <ol className="ml-4 mt-1 list-decimal text-muted-foreground">
                  {instr.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </details>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        LPA · <span className="select-all break-all">{props.lpaCode}</span>
      </div>
    </div>
  );
}

function SeatPickerCard(props: ChannelMessageSeatPicker) {
  const passenger = props.passengerName ?? props.passengerId;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Seat for {passenger}
      </div>
      {props.options.length === 0 ? (
        <div className="text-xs text-muted-foreground">No seats available for this segment.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {props.options.map(opt => {
            const selected = opt.designator === props.selectedDesignator;
            return (
              <li
                key={opt.serviceId}
                className="flex items-center justify-between gap-3 rounded-sm border border-border px-2 py-1.5"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-foreground">
                    {opt.designator}
                    {opt.cabinClass ? (
                      <span className="ml-2 text-muted-foreground">{opt.cabinClass}</span>
                    ) : null}
                  </span>
                  {opt.disclosures && opt.disclosures.length > 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      {opt.disclosures.join(' · ')}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {opt.price} {opt.currency}
                  </span>
                  <CtaButton
                    cta={{
                      kind: 'select_seat',
                      label: selected ? '✓ Selected' : 'Pick',
                      value: JSON.stringify({
                        tripId: props.tripId,
                        offerId: props.offerId,
                        passengerId: props.passengerId,
                        seatServiceId: opt.serviceId,
                        designator: opt.designator,
                        price: opt.price,
                        currency: opt.currency,
                      }),
                      emphasis: selected ? 'secondary' : 'primary',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AncillaryPickerCard(props: ChannelMessageAncillaryPicker) {
  const passenger = props.passengerName ?? props.passengerId;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Bags + extras for {passenger}
      </div>
      {props.bags.length === 0 && (props.cancelForAnyReason?.length ?? 0) === 0 ? (
        <div className="text-xs text-muted-foreground">No optional extras for this offer.</div>
      ) : null}
      {props.bags.map(bag => (
        <div
          key={bag.serviceId}
          className="flex items-center justify-between gap-3 rounded-sm border border-border px-2 py-1.5"
        >
          <div className="flex flex-col">
            <span className="text-xs text-foreground">{bag.label}</span>
            {bag.weightKg || bag.dimensions ? (
              <span className="text-[10px] text-muted-foreground">
                {[bag.weightKg ? `${bag.weightKg}kg` : null, bag.dimensions]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {bag.price} {bag.currency}
            </span>
            <CtaButton
              cta={{
                kind: 'add_bag',
                label: bag.quantitySelected ? `× ${bag.quantitySelected}` : 'Add',
                value: JSON.stringify({
                  tripId: props.tripId,
                  offerId: props.offerId,
                  passengerId: props.passengerId,
                  bagServiceId: bag.serviceId,
                  quantity: 1,
                  label: bag.label,
                  price: bag.price,
                  currency: bag.currency,
                }),
                emphasis: 'primary',
              }}
            />
          </div>
        </div>
      ))}
      {props.cancelForAnyReason?.map(cfar => (
        <div
          key={cfar.serviceId}
          className="flex items-center justify-between gap-3 rounded-sm border border-border px-2 py-1.5"
        >
          <div className="flex flex-col">
            <span className="text-xs text-foreground">Cancel for any reason</span>
            <span className="text-[10px] text-muted-foreground">{cfar.summary}</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            {cfar.price} {cfar.currency}
          </span>
        </div>
      ))}
    </div>
  );
}

function TripBriefCard(props: ChannelMessageTripBrief) {
  const tripLabel = [props.trip.origin, props.trip.destination].filter(Boolean).join(' → ');
  const dateLabel =
    props.trip.startDate && props.trip.endDate
      ? `${props.trip.startDate} → ${props.trip.endDate}`
      : (props.trip.startDate ?? props.trip.endDate ?? '');
  const sevColor = (sev: ChannelMessageTripBrief['alerts'][number]['severity']) =>
    sev === 'critical'
      ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400'
      : sev === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        : 'border-border bg-card text-muted-foreground';

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Trip · {props.trip.status}
        </div>
        {dateLabel ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {dateLabel}
          </div>
        ) : null}
      </div>
      <div className="text-sm font-medium text-foreground">
        {props.trip.name ?? tripLabel ?? props.trip.tripId}
        {props.trip.name && tripLabel ? (
          <span className="ml-2 text-muted-foreground">· {tripLabel}</span>
        ) : null}
      </div>

      {props.alerts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {props.alerts.map((a, i) => (
            <li key={i} className={`rounded-sm border px-2 py-1.5 text-xs ${sevColor(a.severity)}`}>
              {a.message}
            </li>
          ))}
        </ul>
      ) : null}

      {props.flights.length > 0 ? (
        <section className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Flights
          </div>
          <ul className="ml-1 flex flex-col gap-1 text-xs">
            {props.flights.map(f => (
              <li key={f.bookingId} className="flex justify-between gap-2 text-foreground">
                <span>
                  {f.origin ?? '?'} → {f.destination ?? '?'}
                  {f.pnr ? <span className="ml-2 text-muted-foreground">{f.pnr}</span> : null}
                  {f.segmentCount > 1 ? (
                    <span className="ml-1 text-muted-foreground">· {f.segmentCount}-stop</span>
                  ) : null}
                </span>
                <span className="font-mono text-muted-foreground">${f.totalUsd}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.stays.length > 0 ? (
        <section className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Stays
          </div>
          <ul className="ml-1 flex flex-col gap-1 text-xs">
            {props.stays.map(s => (
              <li key={s.bookingId} className="flex justify-between gap-2 text-foreground">
                <span>
                  {s.property ?? 'Hotel'}
                  {s.city ? <span className="ml-1 text-muted-foreground">· {s.city}</span> : null}
                  {s.nights ? (
                    <span className="ml-1 text-muted-foreground">· {s.nights}n</span>
                  ) : null}
                </span>
                <span className="font-mono text-muted-foreground">${s.totalUsd}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.esims.length > 0 ? (
        <section className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Connectivity
          </div>
          <ul className="ml-1 flex flex-col gap-1 text-xs">
            {props.esims.map(e => (
              <li key={e.esimId} className="flex justify-between gap-2 text-foreground">
                <span>
                  {(e.dataMb / 1024).toFixed(1)} GB · {e.validityDays}d ·{' '}
                  {e.countries.join('/') || '—'}
                </span>
                <span className="font-mono text-muted-foreground">{e.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.shareUrl ? (
        <div className="mt-1">
          <a
            href={props.shareUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
          >
            🔗 Share trip
          </a>
        </div>
      ) : null}
    </div>
  );
}

interface ApprovalCardProps {
  travelerName: string;
  route: string;
  amountUsd: number;
  expiresAt?: string;
  reason?: string;
  reviewUrl?: string;
}

/**
 * Inline approval card. Kept distinct from the AI Elements Confirmation
 * primitive: Confirmation expects a ToolUIPart-shaped `state` plus an
 * `approval` object keyed by id, while ChannelMessageApprovalRequest
 * carries traveler / route / amount / reason. Swap once the canonical
 * shape exposes a confirmation kind that maps id + approved + reason
 * directly.
 */
function ApprovalCard(props: ApprovalCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--accent-amber)] bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--accent-amber)]">
          Approval needed
        </div>
        {props.expiresAt ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Expires {new Date(props.expiresAt).toUTCString().slice(5, 22)}
          </div>
        ) : null}
      </div>
      <div className="text-sm font-medium text-foreground">{props.travelerName}</div>
      <div className="text-sm text-muted-foreground">{props.route}</div>
      <div className="text-sm font-mono text-foreground">${props.amountUsd.toFixed(2)} USD</div>
      {props.reason ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Reason: {props.reason.replace(/_/g, ' ')}
        </div>
      ) : null}
      {props.reviewUrl ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <a
            href={props.reviewUrl}
            className="rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
          >
            Approve in console
          </a>
        </div>
      ) : null}
    </div>
  );
}

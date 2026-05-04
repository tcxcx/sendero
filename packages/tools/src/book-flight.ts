import crypto from 'node:crypto';

import { z } from 'zod';
import {
  createHoldOrder,
  getAirlineCredit,
  payFromBalance,
  payOrder,
  type DuffelAirlineCreditId,
  type DuffelPaymentInput,
} from '@sendero/duffel';
import type { ToolDef, ToolContext } from './types';
import { ensureFlightCustomer } from './ensure-flight-customer';
import { ensureTravelerWallet } from './ensure-traveler-wallet';
import { type Prisma, prisma, type MeterPayerType } from '@sendero/database';
import { queryUnifiedBalance } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner, getUserGatewaySigner } from '@sendero/circle/gateway-signer';
import { resolvePayer } from './lib/resolve-payer';
import type { Address } from 'viem';

const serviceSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().min(1).max(9).default(1),
});

const inputSchema = z.object({
  offerId: z.string(),
  /**
   * Optional ancillary services (bags, seats, CFAR) to attach at order
   * creation time. Get these from `list_flight_ancillaries`.
   */
  services: z.array(serviceSchema).optional(),
  /**
   * Additional Duffel CustomerUser ids (`icu_…`) that should have access
   * to this order. The primary traveler is always resolved from the
   * Clerk session via `ensure_flight_customer` — this list is for team
   * leads, assistants, and other parties who should see the order.
   */
  additionalCustomerUserIds: z.array(z.string().min(3)).optional(),
  /**
   * Optional Duffel airline credit (`acd_…`) to redeem toward this
   * booking. If the credit doesn't cover the full order, the remainder
   * is paid from balance. If the credit is larger than the fare, only
   * the fare amount is charged (Duffel applies airline-specific residual
   * rules — see /guides/using-airline-credits).
   */
  airlineCreditId: z.string().optional(),
  /**
   * Override the trip-resolved payer. `tenant` debits the tenant
   * treasury (NOT yet implemented in book_flight — fail-loud); `traveler`
   * debits the traveler's Gateway-unified USDC. Defaults to
   * `Trip.paymentMode` → `Tenant.defaultPaymentMode` → `traveler`.
   * See `packages/tools/src/lib/resolve-payer.ts`.
   */
  provisionedBy: z.enum(['tenant', 'traveler']).optional(),
  /** Optional Trip.id for payer resolution. */
  tripId: z.string().optional(),
});

type BookFlightInput = z.infer<typeof inputSchema>;

export const bookFlightTool: ToolDef = {
  name: 'book_flight',
  description:
    'Book a flight for the signed-in user: ensures the traveler identity exists with the supplier, creates a hold order (with any ancillary services attached), and pays from the pre-funded balance — optionally splitting payment with a traveler airline credit. Returns the PNR + order id. The traveler automatically gets Travel Support Assistant access through their linked identity. Passenger identity comes from the signed-in Clerk session — do not ask the user for name, email, or phone.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['offerId'],
    properties: {
      offerId: { type: 'string' },
      services: {
        type: 'array',
        description: 'Ancillary service ids + quantities from list_flight_ancillaries.',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            quantity: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
          },
        },
      },
      additionalCustomerUserIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Additional icu_… ids to attach (personal assistant, team lead, etc.). The primary traveler is auto-resolved from the session.',
      },
      airlineCreditId: {
        type: 'string',
        description:
          'Airline credit id (acd_…) to redeem toward this booking. Remainder paid from balance.',
      },
      provisionedBy: {
        type: 'string',
        enum: ['tenant', 'traveler'],
        description:
          'Override the trip-resolved payer. `traveler` = current behavior (Gateway-deposited USDC debits). `tenant` is reserved; book_flight returns `tenant_pay_unsupported` until the treasury-debit runtime path lands.',
      },
      tripId: {
        type: 'string',
        description: 'Optional Trip.id for payer resolution.',
      },
    },
  },
  async handler(input: BookFlightInput, ctx?: ToolContext) {
    // Hard gate — `travelerPhone` MUST be passed on the proxy so we can
    // resolve a real Sendero User. Without it, `ctx.traveler.userId`
    // falls through to a `svc:<keyId>` service-account placeholder and
    // the USDC payment gate would silently skip → traveler ticktes for
    // free. Refuse to ticket and tell the agent to retry with phone.
    const travelerUserId = ctx?.traveler?.userId;
    if (!travelerUserId || travelerUserId.startsWith('svc:')) {
      return {
        status: 'traveler_required',
        message:
          'Cannot book — no traveler resolved on this turn. Pass `travelerPhone` (E.164) on `call_sendero` so the booking can be charged to a real wallet.',
      };
    }

    // Auth gate — bookings require a real Clerk-backed identity so the
    // traveler can claim wallet, NFTs, and trip history persistently.
    // The agent persona resolves this by calling
    // `prepare_traveler_signin` and surfacing the URL before retrying.
    if (ctx?.traveler?.isPlaceholder) {
      return {
        status: 'signin_required',
        message:
          "I need you to sign in once before booking — that's how your wallet, balances, and NFT stamps follow you across trips. Reply with the magic link the agent sends, sign in via WhatsApp OTP, and I'll continue this booking automatically.",
      };
    }

    // Payer resolution — book_flight currently implements only the
    // traveler-pay debit path (assertTravelerHasUsdc + Gateway settle).
    // Tenant-pay (treasury debit at swipe time) is a follow-up runtime
    // path. Fail loud rather than silently mismatching `recorded payer`
    // vs `actually-debited wallet`.
    //
    // Resolution precedence:
    //   1. `input.provisionedBy` — explicit per-call override
    //   2. `ctx.payer.type` — turn-level resolution from dispatch
    //   3. `resolvePayer()` — fall back when ctx didn't carry it
    //      (test fixtures, in-process callers)
    let provisionedBy: MeterPayerType = 'traveler';
    if (ctx?.traveler?.tenantId) {
      const ctxPayer = ctx.payer?.type;
      const resolved =
        input.provisionedBy ??
        ctxPayer ??
        (
          await resolvePayer({
            tenantId: ctx.traveler.tenantId,
            tripId: input.tripId,
            travelerUserId: travelerUserId,
          })
        ).type;
      if (resolved === 'tenant') {
        return {
          status: 'tenant_pay_unsupported',
          message:
            'This trip is configured for tenant-treasury debit at swipe time, but `book_flight` only supports traveler-pay today. ' +
            'Either pre-fund the traveler wallet from the tenant treasury and retry, or set Trip.paymentMode=traveler.',
        };
      }
      provisionedBy = resolved;
    }

    const travelerName = ctx?.traveler?.name || 'Traveler';
    const travelerEmail = ctx?.traveler?.email || 'traveler@sendero.demo';
    const travelerPhone = ctx?.traveler?.phone || undefined;

    const customerUserIds: string[] = [];
    let travelerUserRowId: string | null = null;
    if (ctx?.traveler?.userId) {
      try {
        const identity = await ensureFlightCustomer(
          { clerkUserId: ctx.traveler.userId, tenantId: ctx.traveler.tenantId },
          ctx
        );
        customerUserIds.push(identity.supplierTravelerId);
        travelerUserRowId = identity.userId;
      } catch (err) {
        console.warn('[book_flight] ensure_flight_customer failed, continuing without link', err);
      }
    }
    if (input.additionalCustomerUserIds?.length) {
      for (const id of input.additionalCustomerUserIds) {
        if (id && !customerUserIds.includes(id)) customerUserIds.push(id);
      }
    }

    const services = input.services?.map(s => ({
      id: s.id,
      quantity: s.quantity ?? 1,
    }));
    // Hold-order creation, with a one-shot retry that drops
    // `customerUserIds` when Duffel rejects them as
    // `user_already_associated_with_passenger`. The customer-user link
    // is a nice-to-have (Travel Support Assistant access) — never a
    // reason to fail the actual booking. The user can be relinked
    // later via Duffel's relationship API. See
    // https://duffel.com/docs/api/overview/response-handling for the
    // error shape.
    const baseHoldArgs = {
      offerId: input.offerId,
      passengerName: travelerName,
      passengerEmail: travelerEmail,
      passengerPhone: travelerPhone,
      idempotencyKey: `sendero-${input.offerId}-${Date.now()}`,
      services,
    } as const;
    let hold;
    try {
      hold = await createHoldOrder({
        ...baseHoldArgs,
        customerUserIds: customerUserIds.length ? customerUserIds : undefined,
      });
    } catch (err) {
      const errors = (err as { errors?: Array<{ code?: string }> })?.errors ?? [];
      const alreadyAssociated = errors.some(
        e => e.code === 'user_already_associated_with_passenger'
      );
      if (!alreadyAssociated || customerUserIds.length === 0) throw err;
      console.warn(
        '[book_flight] customerUserIds rejected as already-associated — retrying without link',
        { customerUserIds, offerId: input.offerId }
      );
      hold = await createHoldOrder({
        ...baseHoldArgs,
        idempotencyKey: `sendero-${input.offerId}-${Date.now()}-retry`,
      });
    }

    // USDC payment gate — testnet treats 1 USD = 1 USDC. Verify the
    // traveler has enough Gateway-deposited USDC to cover the hold
    // total BEFORE we ticket. Without this check, `payFromBalance`
    // pulls from the Sendero Duffel pool and the traveler gets a free
    // flight. The hold expires automatically (~30 min) if we don't
    // pay it, so insufficient_funds doesn't strand inventory.
    //
    // Hard requirement: USD-denominated bookings only. Non-USD
    // bookings are rare in Duffel today; we'd add an FX-quote step
    // before this gate when they appear.
    if (hold.totalCurrency !== 'USD') {
      console.warn('[book_flight] skipping USDC gate — non-USD currency', {
        currency: hold.totalCurrency,
        orderId: hold.orderId,
      });
    } else {
      const required = Number(hold.totalAmount);
      const fundsCheck = await assertTravelerHasUsdc({
        userId: travelerUserId,
        requiredUsdc: required,
      });
      if (!fundsCheck.ok) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
        const trimmedBase = baseUrl.replace(/\/$/, '');
        // Deep-link the MoonPay top-up flow with the exact required
        // amount pre-filled — `/me/wallet?topup=usdc&amount=N` opens
        // the embedded `<MoonPayBuyWidget>` overlay for signed-in
        // travelers; `moonpayCheckoutUrl` (built below) is the direct
        // hosted checkout for WhatsApp / SMS deep-links where the
        // traveler may not be Clerk-signed-in.
        const meWalletUrl = `${trimmedBase}/me/wallet?topup=usdc&amount=${required.toFixed(2)}`;
        // QR encodes the Sendero wallet deep-link (NOT a raw ethereum:
        // EIP-681 deposit intent). Reason: most travelers don't have
        // MetaMask / Phantom / Rainbow installed, so an `ethereum:0x...`
        // QR opens nothing useful when scanned with a phone camera.
        // The meWalletUrl opens /me/wallet?topup=usdc&amount=<n> in the
        // browser, which auto-opens the embedded MoonPaySellWidget +
        // MoonPayBuyWidget overlay — card pay path that works without
        // a crypto wallet. Crypto-native users still see the bare
        // EVM/Solana addresses in the next button card for direct
        // wallet deposits.
        const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(meWalletUrl)}&size=400&margin=2`;

        // MoonPay direct checkout URL — built inline (rather than
        // calling `moonpay_topup` recursively) so the agent receives
        // a single response. Best-effort: when env keys aren't set we
        // fall back to the address-only path so the booking flow
        // still surfaces deposit guidance.
        let moonpayCheckoutUrl: string | null = null;
        try {
          const apiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
          const signingSecret = process.env.MOONPAY_SIGNING_SECRET;
          if (apiKey && signingSecret && fundsCheck.evmAddress) {
            const isTest = apiKey.startsWith('pk_test_');
            const host = isTest ? 'buy-sandbox.moonpay.com' : 'buy.moonpay.com';
            const params = new URLSearchParams({
              apiKey,
              currencyCode: 'usdc_base',
              baseCurrencyCode: 'usd',
              baseCurrencyAmount: required.toFixed(2),
              walletAddress: fundsCheck.evmAddress,
              externalCustomerId: travelerUserId,
              showWalletAddressForm: 'false',
            });
            const search = `?${params.toString()}`;
            const sig = crypto.createHmac('sha256', signingSecret).update(search).digest('base64');
            params.set('signature', sig);
            moonpayCheckoutUrl = `https://${host}/?${params.toString()}`;
          }
        } catch (err) {
          console.warn('[book_flight] moonpay url build failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return {
          status: 'insufficient_funds',
          requiredUsdc: required.toFixed(2),
          availableUsdc: fundsCheck.totalUsdc,
          walletAddress: fundsCheck.walletAddress,
          evmAddress: fundsCheck.evmAddress,
          solanaAddress: fundsCheck.solanaAddress,
          qrImageUrl,
          meWalletUrl,
          moonpayCheckoutUrl,
          supportedChains: [
            'Arc Testnet',
            'Ethereum Sepolia',
            'Base Sepolia',
            'Avalanche Fuji',
            'Optimism Sepolia',
            'Arbitrum Sepolia',
            'Polygon Amoy',
            'Solana Devnet',
          ],
          orderId: hold.orderId,
          pnr: hold.bookingReference,
          message:
            `Need *${required.toFixed(2)} USDC* to confirm this flight.\n\n` +
            `Your unified balance: *${fundsCheck.totalUsdc} USDC*\n\n` +
            `Send USDC (testnet) to either address — Sendero's unified balance picks it up across all chains:\n\n` +
            (fundsCheck.evmAddress
              ? `🔷 *EVM* (Arc, Ethereum Sepolia, Base, Avax, Optimism, Arbitrum, Polygon)\n\`${fundsCheck.evmAddress}\`\n\n`
              : '') +
            (fundsCheck.solanaAddress
              ? `🟣 *Solana Devnet*\n\`${fundsCheck.solanaAddress}\`\n\n`
              : '') +
            (moonpayCheckoutUrl
              ? `💳 *Top up with a card via MoonPay*: ${moonpayCheckoutUrl}\n\n`
              : '') +
            `Or open your wallet: ${meWalletUrl}\n\n` +
            `Hold *${hold.bookingReference}* is good for ~30 minutes — reply "confirm" once you've topped up.`,
        };
      }
    }

    let paymentStatus: string;
    let paymentBreakdown:
      | Array<{ type: string; amount: string; currency: string; creditId?: string }>
      | undefined;

    if (input.airlineCreditId) {
      // Credit + balance split. Duffel enforces currency and residual rules
      // airline-side; we just sanity check that the credit currency matches
      // the order currency and cap the credit portion at the order total.
      try {
        const credit = await getAirlineCredit(input.airlineCreditId);
        if (credit.spent_at || credit.invalidated_at) {
          throw new Error(
            `airline credit ${credit.id} is ${credit.spent_at ? 'already spent' : 'invalidated'}`
          );
        }
        if (credit.amount_currency !== hold.totalCurrency) {
          throw new Error(
            `airline credit currency ${credit.amount_currency} does not match order currency ${hold.totalCurrency}`
          );
        }
        const orderTotal = Number(hold.totalAmount);
        const creditAvail = Number(credit.amount);
        const creditPortion = Math.min(orderTotal, creditAvail).toFixed(2);
        const balancePortion = (orderTotal - Number(creditPortion)).toFixed(2);

        const payments: DuffelPaymentInput[] = [
          {
            type: 'airline_credit',
            airline_credit_id: credit.id as DuffelAirlineCreditId,
            amount: creditPortion,
            currency: hold.totalCurrency,
          },
        ];
        if (Number(balancePortion) > 0) {
          payments.push({
            type: 'balance',
            amount: balancePortion,
            currency: hold.totalCurrency,
          });
        }

        const result = await payOrder({ orderId: hold.orderId, payments });
        paymentStatus = result[0]?.status ?? 'pending';
        paymentBreakdown = result.map(p => ({
          type: p.type,
          amount: p.amount,
          currency: p.currency,
          creditId: p.airline_credit_id,
        }));
      } catch (err) {
        console.warn(
          '[book_flight] airline credit split failed, falling back to balance-only',
          err
        );
        const payment = await payFromBalance(hold.orderId);
        paymentStatus = payment.status;
      }
    } else {
      const payment = await payFromBalance(hold.orderId);
      paymentStatus = payment.status;
    }

    // Lazy DCW provisioning. The hold succeeded → real intent → it's
    // worth a wallet. Idempotent on userId: subsequent holds for the
    // same traveler reuse the existing DCW. Failures are logged (env
    // missing, Circle 5xx, race) but never block the hold itself.
    let walletAddress: string | null = null;
    if (travelerUserRowId) {
      try {
        const wallet = await ensureTravelerWallet({ userId: travelerUserRowId });
        walletAddress = wallet?.address ?? null;
      } catch (err) {
        console.warn('[book_flight] ensureTravelerWallet failed, hold still confirmed', err);
      }
    }

    // Settle USDC from traveler → tenant treasury. The Duffel ticket
    // has been paid from the Sendero pool; this rebalances the books.
    // Fire-and-forget: a Gateway burn-mint failure must not unticket
    // a confirmed booking. The settlement tx hash is stamped on the
    // booking row out-of-band so the agent can surface it on the next
    // turn ("you paid 140 USDC, tx 0xabc…").
    let usdcSettlement: { settlementTxHash: string; explorerUrl: string } | null = null;
    if (travelerUserRowId && hold.totalCurrency === 'USD' && ctx?.traveler?.tenantId) {
      try {
        usdcSettlement = await settleTravelerUsdcToTreasury({
          travelerUserId: travelerUserRowId,
          tenantId: ctx.traveler.tenantId,
          amountUsdc: hold.totalAmount,
        });
      } catch (err) {
        console.warn('[book_flight] usdc settlement failed (non-fatal)', {
          orderId: hold.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Persist Trip + Booking rows so post-ticketing fan-out (template
    // + NFT stamp + invoice) has anchors. Without these the dispatcher
    // can't find the booking and BOOKING_CONFIRMED never fires.
    let persistedBookingId: string | null = null;
    let persistedTripId: string | null = null;
    if (travelerUserRowId && ctx?.traveler?.tenantId) {
      try {
        const persisted = await persistBookingAndTrip({
          tenantId: ctx.traveler.tenantId,
          travelerUserId: travelerUserRowId,
          duffelOrderId: hold.orderId,
          pnr: hold.bookingReference,
          totalAmount: hold.totalAmount,
          currency: hold.totalCurrency,
          paymentStatus,
          usdcSettlement,
          provisionedBy,
        });
        persistedBookingId = persisted.bookingId;
        persistedTripId = persisted.tripId;
      } catch (err) {
        console.warn('[book_flight] booking persistence failed (non-fatal)', {
          orderId: hold.orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fire-and-forget post-ticketing fan-out — BOOKING_CONFIRMED
    // template + boarding-pass NFT stamp. Same logic the
    // duffel-dispatcher webhook path runs, but invoked inline because
    // our book_flight ticktes synchronously (the webhook path only
    // fires for paused workflows resumed by Duffel).
    if (persistedBookingId && persistedTripId && ctx?.traveler?.tenantId) {
      void firePostTicketingFanout({
        bookingId: persistedBookingId,
        tripId: persistedTripId,
        tenantId: ctx.traveler.tenantId,
        duffelOrderId: hold.orderId,
      });

      // Phase 5 — structured lifecycle events on Trip.events. 'booked'
      // always fires; 'paid' fires separately when a USDC settlement
      // landed (so operators can distinguish hold-vs-paid in the ledger).
      // Atomic jsonb append; tenant double-bound in WHERE.
      const now = new Date().toISOString();
      const events: object[] = [
        {
          id: `booked_${persistedBookingId}_${Date.now()}`,
          kind: 'booked',
          direction: 'internal',
          channel: 'internal',
          createdAt: now,
          bookingId: persistedBookingId,
          pnr: hold.bookingReference,
          totalAmount: hold.totalAmount,
          totalCurrency: hold.totalCurrency,
          paymentStatus,
        },
      ];
      if (usdcSettlement) {
        events.push({
          id: `paid_${persistedBookingId}_${Date.now() + 1}`,
          kind: 'paid',
          direction: 'internal',
          channel: 'internal',
          createdAt: now,
          bookingId: persistedBookingId,
          pnr: hold.bookingReference,
          totalAmount: hold.totalAmount,
          totalCurrency: hold.totalCurrency,
          settlementTxHash: usdcSettlement.settlementTxHash,
          explorerUrl: usdcSettlement.explorerUrl,
        });
      }
      try {
        const payload = JSON.stringify(events);
        await prisma.$executeRaw`
          UPDATE "trips"
          SET events = COALESCE(events, '[]'::jsonb) || ${payload}::jsonb
          WHERE id = ${persistedTripId} AND "tenantId" = ${ctx.traveler.tenantId}
        `;
      } catch (err) {
        console.warn('[book_flight] lifecycle event append failed (non-fatal)', {
          tripId: persistedTripId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Recurring-traveler hint — present when the resolved User has at
    // least one prior trip with any tenant. Mirrors the shape returned
    // by `add_passenger_to_group_trip`. Persona uses it to greet by
    // name and skip passport intake when one is on file.
    let recurringTraveler:
      | { displayName: string | null; priorTripCount: number; hasSavedPassport: boolean }
      | undefined;
    if (travelerUserRowId) {
      try {
        const profile = await prisma.user.findUnique({
          where: { id: travelerUserRowId },
          select: {
            displayName: true,
            _count: { select: { travelerTrips: true, passportVaults: true } },
          },
        });
        if (profile && profile._count.travelerTrips > 0) {
          recurringTraveler = {
            displayName: profile.displayName,
            priorTripCount: profile._count.travelerTrips,
            hasSavedPassport: profile._count.passportVaults > 0,
          };
        }
      } catch (err) {
        console.warn('[book_flight] recurring-traveler lookup failed (non-fatal)', err);
      }
    }

    return {
      orderId: hold.orderId,
      pnr: hold.bookingReference,
      totalAmount: hold.totalAmount,
      totalCurrency: hold.totalCurrency,
      paymentStatus,
      servicesAttached: hold.services,
      customerUserIds,
      airlineCreditRedeemed: Boolean(input.airlineCreditId) && Boolean(paymentBreakdown),
      paymentBreakdown,
      ...(walletAddress ? { travelerWalletAddress: walletAddress } : {}),
      ...(recurringTraveler ? { recurringTraveler } : {}),
      ...(usdcSettlement ? { usdcSettlement } : {}),
      status: 'ticketed' as const,
    };
  },
};

/**
 * Create the Trip + Booking rows so the post-ticketing fan-out has an
 * anchor. Without this, `notifyWhatsAppOnBooking` and the boarding-
 * pass stamp workflow have nothing to find and the BOOKING_CONFIRMED
 * template + NFT_STAMP_READY follow-up never fire.
 *
 * Idempotent on `duffelOrderId` (which carries a global @unique
 * constraint). Re-running for the same Duffel order returns the
 * existing rows instead of double-creating.
 */
async function persistBookingAndTrip(args: {
  tenantId: string;
  travelerUserId: string;
  duffelOrderId: string;
  pnr: string;
  totalAmount: string;
  currency: string;
  paymentStatus: string;
  usdcSettlement: { settlementTxHash: string; explorerUrl: string } | null;
  provisionedBy: MeterPayerType;
}): Promise<{ bookingId: string; tripId: string }> {
  const existing = await prisma.booking.findUnique({
    where: { duffelOrderId: args.duffelOrderId },
    select: { id: true, tripId: true },
  });
  if (existing) return { bookingId: existing.id, tripId: existing.tripId };

  // Find an existing in-progress trip for this traveler in this tenant
  // before minting a new one. A traveler asking the agent to book mid-
  // conversation usually has the trip already implicit; we want every
  // booking on that conversation to land on the same Trip.
  const existingTrip = await prisma.trip.findFirst({
    where: {
      tenantId: args.tenantId,
      travelerId: args.travelerUserId,
      status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  const tripId =
    existingTrip?.id ??
    (
      await prisma.trip.create({
        data: {
          tenantId: args.tenantId,
          travelerId: args.travelerUserId,
          intent: { source: 'book_flight', duffelOrderId: args.duffelOrderId },
          status: 'booked',
          // Pin trip-level payer mode so re-resolution downstream
          // (confirm_booking, settlement, refund) sees the same value
          // without re-deriving from override/tenant default.
          paymentMode: args.provisionedBy,
        },
        select: { id: true },
      })
    ).id;

  const booking = await prisma.booking.create({
    data: {
      tenantId: args.tenantId,
      tripId,
      kind: 'flight',
      status: 'ticketed',
      duffelOrderId: args.duffelOrderId,
      pnr: args.pnr,
      totalUsd: args.totalAmount,
      currency: args.currency,
      bookedAt: new Date(),
      provisionedBy: args.provisionedBy,
      metadata: {
        paymentStatus: args.paymentStatus,
        ...(args.usdcSettlement ? { usdcSettlement: args.usdcSettlement } : {}),
      } as Prisma.InputJsonObject,
    },
    select: { id: true },
  });

  return { bookingId: booking.id, tripId };
}

/**
 * Trigger the post-ticketing fan-out (BOOKING_CONFIRMED template +
 * boarding-pass NFT stamp workflow). The duffel-dispatcher webhook
 * path runs the same logic for paused-workflow resumes; book_flight
 * ticktes synchronously so we have to invoke it ourselves. HTTP call
 * to the existing `/api/duffel/webhook-fanout` endpoint via shared
 * dispatch secret — keeps the implementation in one place.
 *
 * Best-effort. A failure leaves the booking persisted; the agent can
 * follow up later or a separate cron can backfill missing
 * BOOKING_CONFIRMED sends.
 */
async function firePostTicketingFanout(args: {
  bookingId: string;
  tripId: string;
  tenantId: string;
  duffelOrderId: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
  const secret = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!secret) {
    console.warn('[book_flight] no AGENT_DISPATCH_SECRET — skipping post-ticketing fan-out');
    return;
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/internal/booking-fanout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-dispatch-secret': secret,
      },
      body: JSON.stringify({
        bookingId: args.bookingId,
        tripId: args.tripId,
        tenantId: args.tenantId,
        duffelOrderId: args.duffelOrderId,
      }),
    });
    if (!res.ok) {
      console.warn('[book_flight] booking-fanout non-OK', {
        status: res.status,
        bookingId: args.bookingId,
      });
    }
  } catch (err) {
    console.warn('[book_flight] booking-fanout fetch failed (non-fatal)', {
      bookingId: args.bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Sum a traveler's Gateway-deposited USDC across every supported chain
 * + Solana. Returns insufficient when the unified balance would not
 * cover `requiredUsdc`. Surfaces the Gateway depositor address so the
 * agent can ask the traveler to top up at a specific destination.
 */
interface FundsCheckResult {
  ok: boolean;
  totalUsdc: string;
  /** Primary deposit address (EVM if present, else Solana). For older
   *  callers that only display one address. */
  walletAddress: string;
  /** EVM address — the Gateway depositor (Arc, Sepolia, Base, etc.). */
  evmAddress: string | null;
  /** Solana base58 — the Solana DCW. */
  solanaAddress: string | null;
}

async function assertTravelerHasUsdc(args: {
  userId: string;
  requiredUsdc: number;
}): Promise<FundsCheckResult> {
  // 2026-05-04 architecture flip: Gateway depositor for travelers is
  // the Circle DCW (provisioner='dcw'), NOT the legacy
  // UserGatewaySigner EOA. Mirrors `traveler_balance` so book_flight's
  // insufficient-funds card directs the user to the SAME address the
  // wallet card already shows. Querying the legacy signer would
  // surface 0 USDC (we drained it during recovery) even when the user
  // has plenty in their unified balance.
  const SOL_DEVNET_CHAIN_ID = 5;
  const [evmDcw, solanaWallet] = await Promise.all([
    prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', NOT: { chainId: SOL_DEVNET_CHAIN_ID } },
      orderBy: { createdAt: 'asc' },
      select: { address: true },
    }),
    prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', chainId: SOL_DEVNET_CHAIN_ID },
      select: { address: true },
    }),
  ]);
  const evmAddress = (evmDcw?.address as Address | undefined) ?? null;
  const solanaAddress = solanaWallet?.address ?? null;
  if (!evmAddress && !solanaAddress) {
    return {
      ok: false,
      totalUsdc: '0.000000',
      walletAddress: 'pending',
      evmAddress: null,
      solanaAddress: null,
    };
  }
  const balance = await queryUnifiedBalance({
    evm: evmAddress ?? undefined,
    solana: solanaAddress ?? undefined,
  });
  const total = Number(balance.total);
  const primary = evmAddress ?? solanaAddress ?? 'pending';
  return {
    ok: total >= args.requiredUsdc,
    totalUsdc: balance.total,
    walletAddress: primary,
    evmAddress,
    solanaAddress,
  };
}

/**
 * Burn-mint USDC from the traveler's Gateway signer onto the tenant's
 * Gateway signer (same chain — Arc Testnet). The traveler's funds
 * "follow" their booking onto the tenant's treasury. Same-chain
 * burn-mints settle in seconds via Gateway's API.
 *
 * Gateway requires a source chain that has the depositor's USDC. We
 * pick the chain with the largest balance for the traveler.
 */
async function settleTravelerUsdcToTreasury(args: {
  travelerUserId: string;
  tenantId: string;
  amountUsdc: string;
}): Promise<{ settlementTxHash: string; explorerUrl: string } | null> {
  // ── Settlement recipient flip (Phase H billing v1.5, 2026-05-04) ──
  // Why: book_flight pays Duffel out of Sendero's Duffel pool first
  // (`payFromBalance`). The traveler's USDC settlement MUST reimburse
  // Sendero for that draw — otherwise we're underwater on every sale.
  //
  // Pre-flip the recipient was `tenantSigner.address` (the per-tenant
  // gateway-signer EOA). Net P&L per booking: Sendero −$Duffel cost +
  // ~5% take = catastrophic loss. Today's flip: recipient =
  // TREASURY_VIEM_ADDRESS (Sendero platform treasury) so the full
  // Duffel cost reimbursement lands where we paid from.
  //
  // What this means for the tenant: until tenant markup is wired
  // (`Tenant.markupConfig` → quote-time price-up + a SECOND transfer
  // to the tenant gateway-signer for the markup leg), the tenant
  // earns $0 on the booking. That's correct — the booking IS at
  // Duffel cost, and Sendero is the only entity at risk on the float.
  //
  // ── Follow-up: Phase H v2 (markup + tenant share) ──
  // 1. `book_flight` quote-time: read TenantPricingPolicy → return
  //    fareToTraveler = duffelCost + markup; agent confirm card shows
  //    breakdown ("Total: $161 (fare $140 + service $21)").
  // 2. Settlement here splits:
  //      cost           → Sendero (reimburse) — this is the current
  //                        recipient
  //      markup × (1-take) → tenant gateway-signer EOA  ← new transfer
  //      markup × take    → Sendero (custom fee carve)
  // 3. Booking row already has columns for this snapshot
  //    (`costMicroUsdc`, `markupMicroUsdc`, `markupBps`,
  //    `senderoTakeMicroUsdc`).
  //
  // The take-rate-via-customFee logic from the v1 commit is intentionally
  // dropped here because it's the wrong shape: when recipient =
  // Sendero, carving a fee FROM Sendero TO Sendero is a no-op; the
  // carve belongs on the tenant-markup leg in v2.

  const SOL_DEVNET_CHAIN_ID = 5;
  const evmDcw = await prisma.wallet.findFirst({
    where: {
      userId: args.travelerUserId,
      provisioner: 'dcw',
      NOT: { chainId: SOL_DEVNET_CHAIN_ID },
    },
    orderBy: { createdAt: 'asc' },
    select: { address: true },
  });
  if (!evmDcw?.address) return null;

  const senderoRecipient = process.env.TREASURY_VIEM_ADDRESS;
  if (!senderoRecipient) {
    console.warn('[book_flight] TREASURY_VIEM_ADDRESS unset — refusing to settle (would lose money)');
    return null;
  }

  // Lazy import avoids pulling the full unified-gateway module into
  // the cold path of every book_flight invocation that doesn't end up
  // settling (insufficient_funds, tenant_pay_unsupported, etc.).
  const { circleWalletsPrincipal, spend } = await import('@sendero/circle');

  const principal = circleWalletsPrincipal({
    address: evmDcw.address,
    label: `traveler:${args.travelerUserId}:settle`,
  });
  if (!principal) return null;

  console.log('[book_flight] settling (cost-reimbursement to Sendero)', {
    tenantId: args.tenantId,
    travelerUserId: args.travelerUserId,
    amountUsdc: args.amountUsdc,
    recipient: senderoRecipient,
    note: 'tenant markup share is Phase H v2 — not wired yet',
  });

  const result = await spend({
    sources: [{ principal }],
    toChainKey: 'Arc_Testnet',
    recipient: senderoRecipient,
    amount: args.amountUsdc,
  });

  return {
    settlementTxHash: result.txHash,
    explorerUrl: result.explorerUrl ?? `https://testnet.arcscan.app/tx/${result.txHash}`,
  };
}

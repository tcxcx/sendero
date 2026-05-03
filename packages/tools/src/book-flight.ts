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
import { type Prisma, prisma } from '@sendero/database';
import {
  queryUnifiedBalance,
  transferViaGateway,
} from '@sendero/circle/gateway';
import {
  getOrCreateGatewaySigner,
  getUserGatewaySigner,
} from '@sendero/circle/gateway-signer';
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
    const hold = await createHoldOrder({
      offerId: input.offerId,
      passengerName: travelerName,
      passengerEmail: travelerEmail,
      passengerPhone: travelerPhone,
      idempotencyKey: `sendero-${input.offerId}-${Date.now()}`,
      customerUserIds: customerUserIds.length ? customerUserIds : undefined,
      services,
    });

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
        const meWalletUrl = `${baseUrl.replace(/\/$/, '')}/me/wallet`;
        // QR encodes a USDC deposit intent — most wallet apps that
        // scan EVM QR show "send to this address" with USDC pre-
        // selected when the EIP-681 prefix is used.
        const qrPayload = fundsCheck.evmAddress
          ? `ethereum:${fundsCheck.evmAddress}`
          : (fundsCheck.solanaAddress ?? '');
        const qrImageUrl = qrPayload
          ? `https://quickchart.io/qr?text=${encodeURIComponent(qrPayload)}&size=400&margin=2`
          : null;

        return {
          status: 'insufficient_funds',
          requiredUsdc: required.toFixed(2),
          availableUsdc: fundsCheck.totalUsdc,
          walletAddress: fundsCheck.walletAddress,
          evmAddress: fundsCheck.evmAddress,
          solanaAddress: fundsCheck.solanaAddress,
          qrImageUrl,
          meWalletUrl,
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
            `Manage your wallet: ${meWalletUrl}\n\n` +
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
  const [signer, solanaWallet] = await Promise.all([
    getUserGatewaySigner(args.userId, {
      caller: { surface: 'tool', userId: args.userId, context: 'book_flight:funds_check' },
    }),
    prisma.wallet.findFirst({
      where: { userId: args.userId, provisioner: 'dcw', chainId: 5 },
      select: { address: true },
    }),
  ]);
  const evmAddress = (signer?.address as Address | undefined) ?? null;
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
  const travelerSigner = await getUserGatewaySigner(args.travelerUserId, {
    caller: {
      surface: 'tool',
      userId: args.travelerUserId,
      context: 'book_flight:settle',
    },
  });
  if (!travelerSigner) return null;

  const tenantSigner = await getOrCreateGatewaySigner(args.tenantId, {
    caller: { surface: 'tool', context: 'book_flight:settle' },
  });

  // Pick the EVM chain with the most USDC for the traveler — that's
  // where the burn intent originates. Arc is the canonical destination
  // (Sendero's settlement chain); same-chain burn-mints work fine.
  const balance = await queryUnifiedBalance({ evm: travelerSigner.address as Address });
  const evmBalances = balance.balances
    .filter(b => b.chain.toLowerCase() !== 'sol_devnet' && b.chain.toLowerCase() !== 'sol')
    .sort((a, b) => Number(b.balance) - Number(a.balance));
  const sourceChain = evmBalances[0];
  if (!sourceChain || Number(sourceChain.balance) < Number(args.amountUsdc)) {
    // Should be unreachable — the funds-check already guaranteed
    // sufficient unified balance. Bail loudly so a future bug surfaces.
    throw new Error(
      `settleTravelerUsdcToTreasury: no single chain with sufficient balance ` +
        `(need ${args.amountUsdc}, top chain ${sourceChain?.chain ?? 'none'} has ${sourceChain?.balance ?? 0}).`
    );
  }
  const sourceKey = sourceChain.chain as Parameters<typeof transferViaGateway>[0]['from'];

  const result = await transferViaGateway({
    from: sourceKey,
    to: 'Arc_Testnet',
    amountUsdc: args.amountUsdc,
    recipient: tenantSigner.address,
    signer: travelerSigner.account,
  });

  return {
    settlementTxHash: result.mintHash,
    explorerUrl: result.explorerUrl,
  };
}

---
description: Use Sendero to confirm bookings and settle on-chain in USDC. Trigger when the user asks to ticket a held offer, settle a booking, retry a stuck settlement, or verify the on-chain audit trail for a settled trip.
---

# Sendero — Settlement

`confirm_booking` is the moment Sendero spends real money. Treat it like
a payment-API charge: confirm scope before calling, verify the offer is
fresh, and surface the on-chain audit URL after every successful call.

## When to use this skill

- "Settle bk_5c1 from the corporate USDC wallet."
- "Ticket the offer I held for the BUE→MIA leg."
- "The booking didn't go through — retry it."
- "Show me the on-chain trail for trip tr_4d9."
- "What's the take-rate on this settlement?"

## Operating rules

1. **Read scope before settling.** Always summarize the offer back to the
   user (route, fare, refundability, hold expiry) and ask for explicit
   confirmation before calling `confirm_booking`. The tool moves real
   USDC; treat it like signing a wire.
2. **Never settle expired holds.** `hold` returns an `expiresAt`. If
   that timestamp is in the past, re-search and re-hold first.
3. **Take-rate is itemized.** Surface it explicitly:
   `<fare> + <take-rate-bps>bps × <plan-discount>` so finance can
   reconcile against the invoice.
4. **Settlement is final.** On-chain transactions can't be reversed.
   If you need to undo, the path is `refund_booking` — a forward
   transaction that returns USDC to the originating wallet.
5. **Sandbox vs production.** Sandbox keys settle nothing; the
   `MeterEvent.status` is `sandbox`, no Arc transaction lands. Mention
   this to the user when their key is sandbox so they understand the
   call was a dry run.
6. **Surface the Arcscan URL.** Every successful `confirm_booking`
   returns an explorer URL. Print it at the end of your reply so the
   user can hand it to compliance / finance.

## Common errors

- **`HOLD_EXPIRED`** — re-search the inventory, re-place the hold,
  re-confirm with the user before retrying.
- **`CAP_EXCEEDED`** — workspace hit its monthly spend cap. Don't
  retry; propose tier upgrade or scope reduction.
- **`INSUFFICIENT_USDC`** — the workspace's Arc wallet is short. Tell
  the user to top up via the dashboard wallet card or Circle Gateway.
- **`SUPPLIER_REJECTED`** — the carrier returned a downstream error.
  Surface the reason verbatim; recommend a different offer.

## Useful tools in this domain

- `confirm_booking` — the settle action. Auto-triggers the on-chain
  write + take-rate distribution.
- `settle_invoice` — mostly for batched/retry cases (a previously
  ticketed booking whose commission settlement failed).
- `refund_booking` — forward refund. Carrier policy dictates how much
  comes back; take-rate doesn't roll back automatically.
- `wallet_balance` — pre-flight before settling.
- `cap_status` — workspace's monthly spend ceiling + headroom.

## Confirm-before-settle pattern

```
User:  "Ticket the BUE→MIA hold."
Agent: "I have hold hold_a1b: AA off_8f2, BUE 23:55 → MIA 06:45,
        refundable, $842.00 USDC. Take-rate at Pro tier: $4.21
        (50bps × 0.9). Hold expires in 22h 14m. Settle now?"
User:  "Yes."
Agent: → confirm_booking(holdId="hold_a1b")
       "Settled. Booking bk_5c1, PNR PJZ3M1.
        On-chain audit: arcscan.io/tx/0x4f…a17"
```

Don't skip the recap. Even if the user asked you to settle in their
previous message, summarize once before the call. They'll appreciate
the second chance to catch a wrong offer ID.

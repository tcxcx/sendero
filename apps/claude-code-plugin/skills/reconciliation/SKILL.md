---
description: Use Sendero to reconcile on-chain settlements with workspace bookings. Trigger when the user asks to match unmatched settlements, find anomalies, audit reconciliation, or close the books for a period.
---

# Sendero — Reconciliation

The on-chain ledger and the workspace booking ledger should agree row
for row. When they don't, that's a reconciliation gap — either a
settlement landed without a paired booking, or a booking's settlement
went somewhere unexpected. This skill walks Claude through finding and
closing those gaps.

## When to use this skill

- "Match settlements for last week."
- "Find anomalies in our Q2 settlements."
- "Why is bk_5c1 still showing unsettled?"
- "Close the books for March 2026."
- "Show me settlements without bookings."

## Operating rules

1. **Always start with the ledger.** `list_unmatched_settlements`
   returns the on-chain rows that don't have a paired Booking. This is
   ground truth.
2. **Match by holdId + amount first.** `match_settlements --auto`
   pairs unambiguous rows (one settlement, one booking, same amount,
   same holdId metadata). It NEVER guesses.
3. **Surface ambiguous matches.** If `match_settlements` returns a
   `--needs-review` row (multiple candidate bookings, or amount
   mismatch within tolerance), present it to the user with the
   candidates side-by-side. Don't auto-pick.
4. **Anomalies are signals.** Settlement to an unrecognized wallet,
   amount diff > 5%, or duplicate hash all flag a real issue. Stop and
   alert the user; don't try to "smooth" the ledger.
5. **Period closes are immutable.** Once a period is closed
   (`close_period --period 2026-Q1`), reconciliation actions for that
   period require an explicit `--reopen` flag. Tell the user before
   they reopen.

## Useful tools

- `list_unmatched_settlements` — the discovery query.
- `match_settlements [--auto]` — automated matcher; pairs unambiguous
  rows and queues the rest.
- `inspect_settlement <id>` — full on-chain trace for one row, with
  Arcscan URL and the holdId metadata.
- `close_period --period YYYY-QX` — locks a quarter so future
  reconciliation can't quietly modify it.

## Reconcile-then-report pattern

```
User:  "Match all unpaired settlements from last week."
Agent: → list_unmatched_settlements --since 2026-04-21
       "Found 3 unmatched settlements ($1,764.50 total):
        - stl_91a $842.00 → suggests bk_5c1 (holdId match)
        - stl_8e7 $617.00 → suggests bk_5b9 (holdId match)
        - stl_8d2 $305.50 → AMBIGUOUS (2 candidate bookings)

        Auto-match the first two and surface the third for review?"
User:  "Yes."
Agent: → match_settlements --auto
       "Paired 2/3. stl_8d2 still needs review — bk_5a4 ($305.50,
        same date) and bk_5a7 ($302.00, same hold prefix). Which?"
```

## What NOT to do

- Don't manually edit `Booking.settlementId` — the matcher writes it
  through the validated path.
- Don't paper over an amount mismatch by rounding. If a settlement is
  $617.50 and the booking is $617.00, the $0.50 diff is a real
  signal — it's usually a fee delta or an FX leg.
- Don't close a period with open anomalies. The `close_period` tool
  refuses by design.

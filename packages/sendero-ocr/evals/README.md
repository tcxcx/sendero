# @sendero/ocr — evals

Golden-set accuracy harness for the Gemini extraction pipeline.

## Why

"Best Use of Gemini" judging deserves a real number, not a vibe check.
This directory holds a set of documents + hand-labelled ground truth
that we replay against `extractDocument()` on every PR. The runner
reports field-level precision/recall + median latency per kind.

## Layout

```
evals/
  README.md              ← this file
  run.ts                 ← runner; `bun run eval` from the package root
  golden/
    receipts/
      {name}.{pdf|png|jpg}   ← the document
      {name}.yml             ← ground truth (see schema below)
    invoices/
    boarding-passes/
```

## Ground-truth schema

```yaml
kind: receipt              # or invoice, boarding_pass
description: "Coffee shop paper receipt, Italian locale"
expected:
  currency: EUR            # compared case-insensitively
  date: 2026-03-12         # ISO
  total_amount: 8.50       # compared with ±0.01 tolerance
  subtotal_amount: 7.95
  tax_amount: 0.55
  tax_rate: 7
  store_name: "Cafe Sant'Ambrogio"
  payment_method: "credit card"
fuzzy:                     # fields where exact match is too strict
  - store_name             # vendor-name spellings drift
  - website                # www. stripping, subdomain drift
```

Fields present in `expected` but not returned by the extractor count
as misses. Fields in the extraction that aren't in `expected` don't
count against the score — we only grade what we labelled.

## Running

```bash
cd packages/sendero-ocr
bun run eval                       # full golden set, every kind
bun run eval receipts              # one kind
bun run eval receipts/coffee-shop  # one doc
```

Requires the same Gemini creds as the production pipeline
(`GOOGLE_CLOUD_PROJECT` + ADC, or `GOOGLE_GENERATIVE_AI_API_KEY`).
Results append to `evals/results.jsonl` so we can chart accuracy + p50
latency over time.

## Adding a new fixture

1. Drop the document into `golden/{kind}/{slug}.{ext}`.
2. Write `golden/{kind}/{slug}.yml` with the ground truth.
3. Run `bun run eval {kind}/{slug}` — the first run prints the
   extraction so you can verify your ground truth is correct.
4. Commit both files. Never commit documents with real customer PII —
   use synthetic or explicitly-consented samples.

## What to label

Prioritize fields that actually drive downstream business logic:

- **Receipts**: `total_amount`, `currency`, `date`, `tax_amount`,
  `store_name`.
- **Invoices**: `total_amount`, `currency`, `invoice_date`,
  `invoice_number`, `vendor_name`, `customer_name`, `due_date`.
- **Boarding passes**: `pnr`, `passenger_name`, `flight_number`,
  `departure_iata`, `arrival_iata`, `departure_time`.

Line items are tested separately — the runner compares arrays
position-by-position if you set `line_items:` in the ground truth.

## Interpreting results

```
RECEIPTS (12 docs)
  total_amount          12/12  100.0%
  currency              12/12  100.0%
  date                  11/12   91.6%   (1 miss: 2021-japan-receipt.jpg)
  store_name             9/12   75.0%   (3 fuzzy)
  p50 latency           620 ms
  p95 latency          1840 ms
```

75% on `store_name` looks bad until you see "3 fuzzy" — those 3 were
within edit distance 3 of truth, which a human downstream matcher
(e.g. "does this vendor name already exist on this tenant?") treats
as equivalent.

Numbers that actually drive accounting (`total_amount`, `date`) must
hit 95%+. Numbers that drive UX (`store_name`, `payment_method`) are
fine at 80%+.

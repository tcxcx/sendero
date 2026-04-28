---
description: Export Sendero trip + settlement + audit data. Trigger when the user asks for a trip summary PDF, an audit log CSV, a route map for a finance handoff, or any structured data dump for compliance / accountants / travelers.
---

# Sendero — Audit & export

Auditors, finance teams, and travelers all want different shapes of
the same trip data. Sendero ships four export tools that produce
deterministic, on-chain-anchored artifacts. This skill keeps Claude
from rolling its own report generator when a real export tool already
exists.

## When to use this skill

- "Give me a PDF trip summary for tr_4d9."
- "Export Q2 audit log as CSV."
- "I need the route map for the corporate offsite."
- "Send the traveler a copy of their receipts."
- "Pull the on-chain trail for compliance."

## Tool surface

| Tool | Output | Use case |
|------|--------|----------|
| `export_trip_summary` | PDF | Hand to traveler / agency / corporate finance. Itinerary + costs + on-chain anchors. |
| `export_audit_log` | CSV / NDJSON | Hand to auditor. Full meter-event ledger for a period. |
| `export_route_map` | PNG (Satori) + share URL | Traveler-facing "where am I going" graphic. |
| `export_receipts` | ZIP of PDFs | One PDF per ticket / reservation; for expense reports. |

## Operating rules

1. **Pick the right format.** PDFs for humans, CSV for spreadsheets,
   NDJSON for agents/scripts, PNG for messaging. Don't generate a CSV
   when the user is going to forward to an executive.
2. **Period bounds matter.** All exports take a `period` arg
   (`2026-Q2`, `2026-04`, `last-90-days`, or explicit ISO range). Ask
   for the period if it's ambiguous; don't default to "all time."
3. **Surface the URL.** Exports are written to Vercel Blob with a
   signed URL. Print it; don't try to inline-attach the file.
4. **Audit logs are append-only.** `export_audit_log` returns the
   committed, immutable ledger. If a settlement happened during the
   period being exported but hasn't fully landed on-chain, the row is
   marked `pending`. Don't filter those out — auditors want them.
5. **Receipts include both tickets and refunds.** A booking with a
   later refund yields TWO PDFs in the zip; the export tool labels
   each so accountants don't double-count.

## Pattern

```
User:  "Send the Q2 audit log to our accountant."
Agent: "Q2 covers Apr 1 – Jun 30. Format?
         - CSV (Excel-friendly, one row per meter event)
         - NDJSON (scripted ingest, includes nested metadata)"
User:  "CSV."
Agent: → export_audit_log({ period: "2026-Q2", format: "csv" })
       "Generated. 142 events, 87 settlements, 3.1 MB.
        Signed URL (expires in 7 days):
        https://app.sendero.travel/exports/audit-2026-Q2.csv

        Want me to email it to the accountant directly?"
```

## What's in each export

**Trip summary (PDF):**
- Itinerary table (legs, times, airports, PNRs)
- Cost breakdown (fare, taxes, fees, take-rate)
- Settlement table (Arc-Testnet/Arc transaction hashes, Arcscan links)
- Traveler info (redacted to last-4 of identity doc)
- Channel of origin (WhatsApp / Slack / web / MCP)

**Audit log (CSV):**
- Columns: `timestamp, event_type, tenant_id, user_id, tool, micro_usdc, status, metadata_json`
- One row per metered tool call
- Sandbox events tagged `status=sandbox`; pending settlements tagged
  `status=pending`

**Route map (PNG):**
- Static map with airport markers + route polyline
- Sendero brand frame (parchment + vermillion)
- Share-image signed URL valid 7 days; can be unfurled in Slack /
  WhatsApp

**Receipts (ZIP):**
- One PDF per booking + one per refund
- Filename pattern: `<booking_id>-<carrier>-<route>.pdf`
- Includes carrier-issued PNR confirmation when available

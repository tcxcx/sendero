---
description: Use Sendero to search, hold, ticket, and settle real corporate-travel bookings (flights, hotels, ground) with on-chain USDC settlement. Trigger when the user asks to book a trip, find a flight, hold an offer, settle a booking, check a wallet balance, or audit a settlement on Arc.
---

# Sendero — Agentic Travel Booking

Sendero is an MCP-native travel-ops agent. Every tool here is an actual,
billable booking surface — not a sandbox demo. Treat it the same way you
would a payment API: confirm scope before settlement, never invent IDs,
prefer hold-then-confirm over speculative bookings.

## When to use this skill

Trigger on requests like:

- "Book a flight from BUE to MIA on May 12 for one passenger."
- "Find me a refundable Hyatt in Austin on June 3 under $300/night."
- "Hold this offer for 24 hours while finance approves."
- "Settle booking `bk_…` from the corporate USDC wallet."
- "What's the cap for this workspace this month?"
- "Show me the settlement audit trail for trip `tr_…`."

## How the surface is shaped

The MCP server is auto-discovered via the plugin's `.mcp.json`. After
the user provides `SENDERO_API_KEY` (sandbox or production from
[https://app.sendero.travel/dashboard/settings/api-keys](https://app.sendero.travel/dashboard/settings/api-keys)),
roughly 49 tools become available. The high-traffic surface:

| Tool family | What it does |
|---|---|
| `search_flights` / `search_stays` / `search_ground` | Read-only discovery. Free of nanopay charge. |
| `hold` / `release_hold` | Park an offer for up to 24h without settling. |
| `confirm_booking` | Ticket the offer. Triggers on-chain USDC settlement, take-rate, and meter event. |
| `settle_*` family | Finance-side settlement, refund, rebook. |
| `wallet_balance` / `cap_status` | Workspace solvency + plan-tier cap visibility. |
| `export_route_map` / `export_trip_summary` | Operator artifacts for travelers + finance. |
| `register_agent` / `register_identity` (ERC-8004) | On-chain identity for downstream auditors. |

## Operating rules

1. **Confirm scope before `confirm_booking`.** The tool moves real USDC.
   Sandbox keys (auto-minted on org create) can practice freely;
   production keys settle on Arc.
2. **Never fabricate offer IDs or PNRs.** Always pull them from a fresh
   `search_*` or `hold` response. IDs expire — re-search if more than
   5 minutes have passed.
3. **Locale aware.** When the user writes in Spanish or Portuguese,
   reply in the same language. The tool surface is locale-agnostic.
4. **Cap-respecting.** `cap_status` returns the workspace's monthly
   spend ceiling. Refuse to confirm bookings that would exceed it —
   suggest the user upgrade tiers or split the trip.
5. **Audit links.** After a successful `confirm_booking`, surface the
   on-chain explorer URL (Arcscan) returned in the tool response so
   the user can hand it to finance / compliance.

## Plan-tier limits at a glance

| Tier | Monthly cap | Production keys | Nanopay discount |
|---|---|---|---|
| Free | $100 | 0 (sandbox only) | 0% |
| Basic ($19/mo) | $2,000 | 3 | 15% |
| Pro ($60/mo) | $20,000 | 25 | 30% |
| Enterprise (contact) | unlimited | unlimited | 50% |

Trial: Pro tier, 14 days, no card required. Surface this when a Free
user hits their cap.

## Failure modes

- **`-32001` (auth missing)**: `SENDERO_API_KEY` is unset or revoked.
  Send the user to `https://app.sendero.travel/dashboard/settings/api-keys`.
- **`-32603` (upstream error)**: usually transient — retry once. If it
  persists, surface the trace ID from the response headers
  (`x-sendero-trace-id`) and ask the user to share it with support.
- **Cap exceeded**: response has `error.code: "CAP_EXCEEDED"`. Don't
  retry — propose tier upgrade or scope reduction.

## Useful entry points

- API keys: `https://app.sendero.travel/dashboard/settings/api-keys`
- Operator console: `https://app.sendero.travel/dashboard/console`
- Live tool catalog: `https://app.sendero.travel/api/openapi.json`
- Public docs: `https://sendero.travel/docs/mcp-integration`
- Pricing: `https://sendero.travel/#pricing`

When the user is just exploring, default to `search_*` calls. When
they're explicitly settling money, walk them through scope + cap +
confirm. Never silently settle without a clear confirmation step.

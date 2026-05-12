# Sendero — 3-minute demo script

WhatsApp + Slack are the highlights. Web dashboard is the reconciler. Three audiences, one ledger.

---

## The framing (memorize)

> "Sendero is a vertical AI agent for travel ops. Three audiences, three channels: the TMC operator runs everything from web. Their corporate clients install Sendero in their own Slack. Travelers chat over WhatsApp. Same trip, same on-chain ledger, all three channels — that's the wedge. Per-seat tools cap at HR budget. We charge percent of revenue plus agent-to-agent nanopayments."

Say that in 18–20 seconds. Then go.

---

## Pre-flight (do 5 min before)

- [ ] Phone on +593980668984 connected to WiFi, WhatsApp open to `+56 9 2040 3095` thread.
- [ ] Tomas's Arc DCW funded — drip via faucet so balance > 0:
      `bun apps/app/scripts/_local/diagnose-tomas-funds.ts` then send the bot "drip me 5 USDC on Arc".
- [ ] Browser tab 1 → `/dashboard` (logged in as TMC operator).
- [ ] Browser tab 2 → `/dashboard/inbox/[tripId]` (pick an existing trip with Slack + WhatsApp activity).
- [ ] Browser tab 3 → `/dashboard/customer-accounts/[id]/policy` (so you can flash the policy editor).
- [ ] Browser tab 4 → Slack workspace in the corporate customer's tenant; have `#sendero` channel open with the bot member.
- [ ] Confirm Kapso health: `bun apps/app/scripts/_local/diagnose-wa-live.ts` — last webhook event within 5 min, signatureValid=Y, dispatchedCount > 0.
- [ ] Mute Slack desktop notifications. Bot replies are the demo; pings are noise.
- [ ] Camera over the phone so people see WhatsApp UI directly, not a screen mirror.

---

## Beat sheet

```
0:00 — 0:20   OPEN — pitch + topology (talk only)
0:20 — 1:30   ACT 1 — WhatsApp traveler (highlight)
1:30 — 2:30   ACT 2 — Slack corporate buyer (highlight)
2:30 — 2:50   ACT 3 — Operator merged inbox (reconciler)
2:50 — 3:00   CLOSE — wedge + traction line
```

---

## 0:00 — OPEN (20s, talk only)

Say the framing paragraph. End with: *"Let me show you all three. Start with the traveler."*

---

## 0:20 — ACT 1: WhatsApp traveler (70s)

Camera on phone. Type slowly so the audience can read.

| Beat | You type | Bot replies | What to say |
|---|---|---|---|
| Identity | `qué agencia es esta?` | Brand card: agency name, slug, on-chain reputation status | "Sendero is an AI platform; the customer-facing brand is always the agency. The agent reads ERC-8004 identity on-chain — once the agency has reviews, they'll show up here." |
| Wallet | `mi billetera` | Multi-chain unified balance card: Arc, Sol, 6 EVM testnets | "Every traveler gets a Circle DCW on every chain. **Unified USDC balance** via Circle Gateway. Deposit anywhere, settle anywhere — sub-second on Arc." |
| Doc scan | *(send a passport photo from camera roll)* | OCR result: name, doc number redacted, expiry highlight | "Gemini Vision through our `scan_passport_inline` tool. Document goes into the encrypted PassportVault. Compliance-gated — only the traveler and the operator can decrypt." |
| Booking | `un vuelo CDMX a Lima el martes próximo` | Search results card with 3 Duffel offers | "That's a real Duffel call — live inventory through StableTravel and Duffel. The agent will hold and confirm on-chain through SenderoGuestEscrow." |

**Recovery moves:**
- If wallet shows 0 USDC → say "fresh DCW, watch the faucet drip" then `drip me 5 USDC on Arc`.
- If Gemini stalls (>4s) → talk over it: "vision call going through Vertex right now — typically returns in two to three seconds; this one's slower."
- If Duffel returns empty → fall back: `un hotel en Lima por $180 la noche` (hotel inventory is more reliable for demo).

---

## 1:30 — ACT 2: Slack corporate buyer (60s)

Switch to Slack. The audience now sees the **B2B2B** layer.

> "This is a different Slack workspace — Acme Corp installed Sendero into their own workspace. Their employees self-serve travel from inside their own company chat. The TMC operator never sees this thread directly; they see it surface in the web dashboard. That's the B2B2B wedge."

| Beat | Action | Visible result | What to say |
|---|---|---|---|
| Request | `@sendero book a hotel in Lima next Tuesday under $200/night for [employee name]` | Bot: "Checking policy…" then results card | "Every corporate request runs through `check_policy` — per-customer-account policy editor lives on the TMC's dashboard." |
| Policy gate | *(if approval threshold hit)* Bot posts approval card | Block Kit card with **Approve / Reject** buttons | "Approval-required flow. Liveblocks fan-out — the operator sees this same approval request in real-time on web." |
| Approval | Click **Approve** in Slack OR on web | Booking confirms in both places | "Web and Slack stay in sync through Liveblocks + ChannelMessage. Operator can intervene from either surface." |

**Recovery moves:**
- If `check_policy` returns no policy → fine, that means auto-approve; just continue.
- If Liveblocks lag → switch tabs to `/dashboard/handoffs` and click Approve from web; Slack will update.

---

## 2:30 — ACT 3: Operator merged inbox (20s)

Switch to Browser tab 2 → `/dashboard/inbox/[tripId]`.

> "This is the TMC operator view. Same trip — three lanes side by side: Slack from the corporate, WhatsApp from the traveler, web for operator interventions. ChannelIdentity ties one logical traveler across all three. The operator never has to context-switch."

Pan across the three lanes. Hover the latest message. Show the trace ID footer (Langfuse link).

**Bonus flash (if time):** click into `/dashboard/customer-accounts/[id]/policy` — show the per-customer policy editor for 3 seconds. "TMCs set policy per corporate client. Per-vertical-agent template."

---

## 2:50 — CLOSE (10s)

Say:

> "Three audiences. One ledger. USDC settlement on Arc and Solana. We've shipped the agent, the channels, the policy layer, and the on-chain rail. Three paid TMC pilots, twelve in pipeline. Won Best Gemini Implementation at Arc Hackathon. Travel ops is the wedge — buyer × supplier × ops triangle is the moat."

---

## Things to NEVER say in the demo

- "Token launch" — don't have one, don't plan one. Crypto is plumbing.
- "Chatbot" — we're agent-native, multi-tool, multi-channel.
- "It's just OpenAI" — the persona is composed in Langfuse, the prompts are evaluated nightly, the model is gateway-routed with Vertex direct fallback.
- "We're like Concur" — explicitly anti-Concur (compliance-first CRUD travel bolted to a chatbot).
- Anything about the sandbox tenant by name. It's plumbing.

---

## Things to ALWAYS say

- **"On-chain audit"** when settlement comes up. Arcscan link is your friend.
- **"Same trip, three channels"** when switching surfaces.
- **"Vertical AI"** — not horizontal agent. Stay on category.
- **Take rate + nanopay** when pricing is asked. Never per-seat.

---

## If something completely breaks

Two graceful pivots:

1. **WhatsApp is dead** → switch entirely to web operator chat at `/dashboard/agent-chat`. Same agent, same tools, same on-chain rail. Frame it as "the operator chat surface — useful when an operator wants to invoke the agent directly without going through a channel."

2. **Web dashboard is dead** → stay in Slack + WhatsApp. Frame it as "operator visibility is a reconciler layer — channel surfaces are independent and durable. If the dashboard hiccups, the agent keeps booking trips."

Never debug live. Move on, fix later.

---

## Tools you may want to call manually before demo

```bash
# Confirm WhatsApp pipeline is hot
bun apps/app/scripts/_local/diagnose-wa-live.ts

# Confirm tenant resolution working
bun apps/app/scripts/_local/verify-tenant-resolver.ts

# Confirm Tomas's DCWs + funds
bun apps/app/scripts/_local/diagnose-tomas-funds.ts

# If passport demo needed: pre-warm Gemini with one throwaway scan via /dashboard/scan
```

---

## After the demo

- Save the conversation traceIds (Langfuse) for follow-up.
- Note any "what about X?" questions that came up — file them under `/dashboard/handoffs` or as docs/agent-gaps/board.md entries.
- If demo'd a real prospect, log the meeting in your tracker.

Three minutes. Twelve beats. Three audiences. One ledger.

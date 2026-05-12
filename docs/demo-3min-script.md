# Sendero — 3-minute demo script

A founder/builder, an AI co-founder, and a real Duffel order pull off a single trip
across three channels in 180 seconds. Email invitation cold open. Then onboarding,
then the dashboard tour, then the agent live on WhatsApp + Slack, then the close.

---

## The framing (memorize, 18 seconds)

> "Sendero is a vertical AI agent platform for travel ops. Same trip, three channels:
> the TMC operator runs everything from web, the corporate-customer installs Sendero
> in their own Slack, the traveler chats over WhatsApp. One on-chain ledger ties all
> three together. USDC settlement on Arc and Solana. We don't charge per seat — we
> take a cut of revenue plus agent-to-agent nanopayments. Travel is the wedge;
> agent-native vertical service businesses are the moat."

Open with that. Then drop the email.

---

## Pre-flight (do 5 min before)

- [ ] Browser tabs (in order):
  1. **Gmail** open on the unread "Invitation to join Sendero Travel" email.
  2. `app.sendero.travel/onboarding/agency` — Sol-primary preselected so bootstrap path matches the demo.
  3. `app.sendero.travel/dashboard` — operator home.
  4. `app.sendero.travel/dashboard/agent-chat` — operator agent console.
  5. `app.sendero.travel/dashboard/channels/whatsapp` — sandbox bind ready.
  6. `app.sendero.travel/dashboard/channels/slack` — Slack OAuth install ready.
  7. `app.sendero.travel/dashboard/inbox` — trip merged inbox.
- [ ] Phone on `+593980668984`, WhatsApp open to the sandbox thread `+56 9 2040 3095`.
- [ ] Slack: corporate-customer workspace (Acme Corp), `#sendero` channel, bot installed.
- [ ] Funded tenant `cmp214zo20000c1o4c3p5ge7m` (Enterprise Test) signed in. Unified
      balance ≥ $20 on Sol Gateway pool (`FkSc…udDL`) + ≥ $1 on Arc Testnet. Run
      `bun apps/app/scripts/_local/where-is-20.ts` to confirm.
- [ ] Tomas's traveler Arc DCW has > 0 USDC. If empty, ask the bot `drip me 5 USDC on Arc`.
- [ ] Camera over the phone — audience watches WhatsApp directly, not screen mirror.
- [ ] Mute Slack desktop notifications. Pings during the bot reply window kill flow.
- [ ] Confirm the Kapso pipe is hot: open
      [`/dashboard/channels/whatsapp/inbox`](https://app.sendero.travel/dashboard/channels/whatsapp/inbox)
      — last inbound event within the last 5 minutes.

---

## Beat sheet

```
0:00 — 0:20   COLD OPEN — framing + the invitation email
0:20 — 0:50   SETUP — accept invite → onboarding → bootstrap (wallets, gateway, identity)
0:50 — 1:15   TOUR — dashboard, operator agent console, channel install (Slack + WhatsApp)
1:15 — 2:30   WHATSAPP LIVE — passport, wallet, flight, eSIM, restaurants, ancillary
2:30 — 2:50   SLACK LIVE — corporate buyer + policy + Liveblocks handoff
2:50 — 3:00   CLOSE — one-sentence wedge + traction
```

12 beats. Don't run long on any single act — every overrun eats the close.

---

## 0:00 — COLD OPEN (20s)

Say the framing paragraph while showing **Gmail**.

> "Today, someone signs up. This is the email they get."

Click into "Invitation to join Sendero Travel". Show the binoculars hero, the **Accept invitation** button, the 30-day expiry.

> "Clerk-issued, signed, 30-day TTL. Click."

Click **Accept invitation**.

**Vision beat:** Sendero is a platform for spinning up vertical AI agents. Travel
is the first vertical; legal, real-estate, and healthcare reuse the same shell.
The invitation flow we're about to walk through provisions *everything* a vertical
needs in under 30 seconds.

---

## 0:20 — SETUP: onboarding + bootstrap (30s)

Land on `/onboarding/agency`. Pick **Solana-primary** (so the cross-chain settle in
the WhatsApp act gets to flex Phase 4.5). Click **Continue**.

| What you see | What to say |
|---|---|
| Wait screen with five orange dots animating | "Five things spinning up in parallel — same architecture for every new vertical." |
| Treasury wallet check ✓ | "Circle MSCA on Arc + Squads V4 vault on Sol. The tenant's money lives here." |
| Operations DCWs ✓ | "One Circle DCW per chain — Arc, Base, Avalanche, Polygon, Arbitrum, Optimism, Sol Devnet. These receive inbound USDC; the Gateway sweep pools them." |
| Gateway depositor ✓ | "Self-custody Sol signer encrypted under SENDERO_KEK + EVM Gateway signer. This is what makes Sol funds spendable cross-chain — Phase 4.5 we just shipped." |
| Identity mint ✓ | "ERC-8004 agent identity on Arc and Metaplex Agent Registry on Sol. The agency now has an on-chain reputation surface that compounds across every booking." |
| Done → redirect to `/dashboard` | "30 seconds. Bootstrap done. Same template, every vertical." |

**Recovery:** if the Sol identity stage fails (Metaplex blip), don't dwell —
"Sol identity is async, retries on the next dashboard navigation." Move on.

---

## 0:50 — TOUR: dashboard + agent console + channel install (25s)

Land on `/dashboard`. Three things to flash:

1. **Unified balance pill** (top right) — pop the dropdown.
   > "$21 USDC. One USD coin across Arc + Sol — Circle Gateway pools them. Spend
   > from any chain, mint on any chain, sub-second. We just shipped Sol-source
   > spending. Watch the live route — Solana Devnet $20, Arc Testnet $1, both
   > spendable."

2. **Operator agent console** (`/dashboard/agent-chat`).
   > "Operator can talk to the agent directly. Same agent that runs on WhatsApp and
   > Slack — same tools, same persona, same on-chain rail. Useful for one-off ops
   > work or testing prompt changes."
   Click into one recent conversation, scroll the tool calls.

3. **Channels install** (`/dashboard/channels/whatsapp` then `/dashboard/channels/slack`).
   > "Two-click WhatsApp via the Sendero sandbox number for testing — paid plans
   > swap in a dedicated number through Kapso. Slack is one OAuth click — that's
   > the corporate-customer install, deployed into the *corporate's* workspace,
   > not the operator's. B2B2B in one click."

**Vision beat:** three audiences, three surfaces, one tenant. The operator never
context-switches; everything reconciles to `/dashboard/inbox/[tripId]`.

---

## 1:15 — WHATSAPP LIVE (75s, highlight act)

Camera on phone. Switch to the WhatsApp thread. Type slowly so the audience reads.

| # | You type | Bot replies | What to say |
|---|---|---|---|
| 1 | `qué agencia es esta?` | Brand card: "Enterprise Test", on-chain reputation status | "The agent reads ERC-8004 — once the agency has reviews on Arc, they surface here. Sendero is always the platform; the brand is always the agency." |
| 2 | *(send a passport photo)* | OCR result, doc number + expiry; "vault sealed" footer | "Gemini 2.0 Vision through `scan_passport_inline`. Document goes into PassportVault — AES-GCM-encrypted, KEK in Vercel sensitive env. Only the traveler and operator can decrypt." |
| 3 | `mi billetera` | Unified balance card: Arc + Sol breakdown + 6 EVM testnets | "Every traveler gets a Circle DCW on every chain. Unified balance via Gateway. Same model that just shipped for the *tenant* — Sol funds are spendable across chains." |
| 4 | `un vuelo CDMX a Lima el martes próximo` | Card with 3 Duffel offers + interactive buttons | "Real Duffel inventory through `search_flights`. The card is native WhatsApp interactive — buttons, list pickers, image carousels. Same canonical `ChannelMessage` renders to Slack and web." |
| 5 | *(tap top offer's Confirm button)* | Booking confirmed; settlement on-chain; NFT BoardingPass card | "SenderoGuestEscrow on Arc holds funds until ticketing. Cross-chain settlement burns Sol pool + mints Arc for the supplier. Metaplex BoardingPass NFT lands in the traveler's wallet — that's their proof of trip." |
| 6 | `eSIM 2GB para Perú` | eSIM card with QR + activation steps | "`search_esim` + `book_esim` through our Stable Travel partner. USDC settles inline. eSIM is an ancillary; same pricing policy and take-rate as flights." |
| 7 | `restaurantes cerca de Miraflores` | Curated list — Bib Gourmand finder + neighborhood color | "Local concierge tools: `recommend_restaurants` composes Google Places + Bib Gourmand + Sendero's own taste graph. This is where the vertical shines — not just booking, *being there*." |
| 8 | `add baggage` | Selection card, picks 23kg checked | "`add_baggage` stages an ancillary on the booking. Pre-ticketing → forwarded to Duffel as a service. Post-ticketing → Duffel order change. Sendero handles both shapes." |

**Speed up if needed:** skip beats 7 and 8. Keep 1, 2, 3, 4, 5, 6 — passport, wallet,
flight, eSIM is the headline.

**Recovery moves:**
- Duffel empty → fall back to `un hotel en Lima por $180`. Hotel inventory is deeper.
- Gemini stalls > 4s → talk over it: "Vertex grounded call; sub-3-seconds typical."
- Sol cross-chain spend errors → it's the mint-retry path we built last night;
  Arc's gateway service eventually mints anyway. Don't dwell.

**Vision beat:** the agent isn't a chatbot routing to a CRUD app. It's a vertical
service business: tools-first, multi-channel, settlement-native. Every booking writes
to the on-chain ledger.

---

## 2:30 — SLACK LIVE (20s, B2B2B layer)

Switch to Slack — the corporate-customer's workspace, not the operator's.

> "This is Acme Corp's Slack. They installed Sendero into their own workspace.
> Their employees self-serve travel from inside the company chat. The TMC operator
> never sees this thread directly — they see it surface in `/dashboard/inbox`."

| Beat | Action | Visible result | What to say |
|---|---|---|---|
| Request | `@sendero book SFO → LIM next Tuesday under $1,800 for Tomas` | "Checking policy…" → results card | "Every corporate booking runs through `check_policy` — per-customer policy lives on the TMC's dashboard. $1,500 threshold; this trips it." |
| Approval | Approval card with **Approve / Reject** buttons | Block Kit card | "Liveblocks fans this out — operator sees the same approval card live on web. Click either surface, both update." |
| Approve | Click **Approve** on Slack | Booking confirms on Slack AND on web `/dashboard/handoffs` | "Same trip. Three channels. One ledger." |

**Vision beat:** this is the B2B2B layer. The TMC sells Sendero to corporate
clients; the corporate installs into their own Slack; the traveler interacts via
WhatsApp. Three audiences, one trip, one tenant — Sendero pools the take rate.

---

## 2:50 — CLOSE (10s)

Switch to `/dashboard/inbox/[tripId]` for the closing visual — three lanes side by
side, the same trip we just booked, Slack + WhatsApp + web all stitched.

> "Three audiences. One ledger. USDC settlement on Arc and Sol — both spendable,
> shipped last night. We've shipped the agent, the channels, the policy gate, the
> on-chain rail, and the multi-vertical platform shell. Travel is the wedge;
> agent-native service businesses are the moat."

If pitching investors, add: *"Best Gemini Implementation at the Arc Hackathon. Three
TMC pilots in market. Twelve in pipeline."*

Stop talking. Let it land.

---

## Things to NEVER say

- "Token launch" — we don't have one, don't plan one. Crypto is plumbing.
- "Chatbot" — agent-native, multi-tool, multi-channel.
- "Just OpenAI" — Langfuse-composed persona, Vertex direct first, gateway fallback.
- "Like Concur" — explicitly the opposite.
- The sandbox tenant by name. It's infrastructure.

## Things to ALWAYS say

- **"On-chain audit"** when settlement comes up. Arcscan link is your friend.
- **"Same trip, three channels"** when switching surfaces.
- **"Vertical AI"** — not horizontal agent.
- **"Take rate + nanopay"** when pricing comes up. Never per-seat.
- **"Phase 4.5"** when Sol cross-chain spend comes up. Signals we ship weekly.

---

## If something completely breaks

Two graceful pivots:

1. **WhatsApp dead** → switch entirely to `/dashboard/agent-chat`. Same agent, same
   tools, same on-chain rail. Frame: "the operator chat surface — useful when an
   operator wants to invoke the agent directly without going through a channel."
2. **Web dashboard dead** → stay in Slack + WhatsApp. Frame: "operator visibility
   is a reconciler layer. Channel surfaces are durable and independent — if the
   dashboard hiccups, the agent keeps booking trips."

Never debug live. Move on; fix later.

---

## Diagnostics (run before, not during)

```bash
# unified balance + Sol Gateway pool sanity
bun apps/app/scripts/_local/where-is-20.ts

# Tomas traveler funds
bun apps/app/scripts/_local/diagnose-tomas-funds.ts

# Kapso pipeline + last webhook timestamp
bun apps/app/scripts/_local/diagnose-wa-live.ts

# pre-warm Gemini Vision (if passport beat is in the cut)
# → upload one throwaway scan via /dashboard/scan first
```

---

## After the demo

- Save the conversation traceIds (Langfuse link footer in agent-chat).
- Log unanswered questions under `/dashboard/handoffs` or as
  `docs/agent-gaps/board.md` entries.
- If a real prospect demo, log the meeting + push the follow-up trip into their
  tenant's `/dashboard/inbox` for cross-channel continuity.

Three minutes. Twelve beats. Three audiences. One ledger.

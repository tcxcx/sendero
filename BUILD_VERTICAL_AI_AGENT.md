# Build a Vertical AI Agent

A founder template synthesizing a16z's "Come for the Agent, Stay for the Network" thesis (Speedrun 2026) and YC's Summer 2026 RFS into a **fill-in-the-blanks workbook** for designing a vertical AI agent that can compound into a network-effects platform.

Use this as a planning artifact: copy it to a new repo's `BUILD_VERTICAL_AI_AGENT.md`, fill in the bracketed sections, and use it as the strategic foundation that every product, eng, and GTM decision references back to. Re-read it quarterly — the network thesis is the moat thesis, and it's easy to drift back into "we sell software" thinking once shipping speed picks up.

---

## Section 1 — The wedge (a16z framework, applied)

**Wedge thesis (one sentence):**
> [Industry actor] needs [transactional outcome] today. Traditionally: [N hours / N calls / paper trail]. With our agent: [seconds / autonomous / one prompt].

**Concrete user-day-in-the-life:**
- [Persona] does [task] today by [manual workflow]. Time: [hours].
- With our agent: [task] becomes [agentic flow]. Time: [minutes].
- Result for the user: [emotional + economic outcome].

### Six-precondition self-test (a16z's market filter)

Tick each — your wedge needs at least 4/6 to clear.

- [ ] **Fragmented supply** — [list top 3 suppliers; if there are 50+, you pass]
- [ ] **Offline suppliers** — [are vendors still selling via email/PDF/phone? if yes, you pass]
- [ ] **Opaque or elastic pricing** — [is "list price" different from "real transaction price"? if yes, you pass]
- [ ] **Frequent purchases** — [does the same buyer transact multiple times per month? if yes, you pass]
- [ ] **Different SKUs** — [do buyers shop across many distinct items? if yes, you pass]
- [ ] **Commoditized product or service** — [is "Brand X widget" interchangeable with "Brand Y widget"? if yes, you pass]

Score: **[N]/6**. If less than 4, the agent might be valuable but it won't network — you're in vertical SaaS territory, not platform territory.

### What the wedge is NOT

- [ ] Not a chatbot bolted onto existing software.
- [ ] Not a copilot that helps the human do their job — it does the job.
- [ ] Not a "search + summarize" layer over public data.
- [ ] Not feature-parity with an incumbent.

If you find yourself describing the wedge as any of the above, redesign before writing code.

---

## Section 2 — The network (the moat, where margin lives)

The wedge gets users in. The network is what makes leaving cost them money. Every vertical AI agent founder should answer these explicitly:

**What data does the agent generate that becomes more valuable as N users grow?**
- [Real transaction prices vs list prices? Supplier behavior under demand pressure? Buyer-side preferences across thousands of jobs? Failure modes per SKU?]

**What "you're paying X% above market" insight unlocks at N=100? N=1000? N=10000?**
- N=100: [the smallest N where insight starts being non-trivial]
- N=1000: [the N where TMCs/buyers start switching to you BECAUSE OF the insight, not the agent]
- N=10000: [the N where suppliers come to you to negotiate access]

**What's the supply-side flip moment?**
- Before: [suppliers thrived on offline opacity]
- After: [suppliers compete to be plugged into our agentic network — what does that competition look like? are they offering us a discount, exclusive SKUs, or priority allocation?]
- Trigger: [N buyers AND/OR transactions per supplier per month]

**Demand aggregation: what's the bundling story?**
- [Single buyer does N transactions/month; we aggregate across our buyers for negotiated rates. What's the smallest bundle that moves price? When can we credibly threaten to redirect demand?]

### Six dormant network signals to watch for

If you're not surfacing these to users by month 12, you're leaving moat on the table:

1. [ ] Real-transaction-price benchmark per SKU/route ("you paid 18% above platform median")
2. [ ] Demand bundling dashboard ("your N customers spend $X on this — let's negotiate")
3. [ ] Supplier reliability scorecard (lead-time, defect rate, price stability) per supplier
4. [ ] Cross-buyer "what other operators in your shoes are paying" comparison (anonymized, k>=20)
5. [ ] Price-elasticity alerts ("supplier X just raised 5% on SKU Y — switch to Z?")
6. [ ] Buyer-side power: aggregate-demand offers ("we'll commit $X to whichever supplier offers Y")

---

## Section 3 — Pricing model (the % of revenue check)

a16z's note: "by unlocking an efficient marketplace, you can charge on a % of revenue basis vs token or seat basis."

**Don't price like SaaS. Price like Stripe.**

| Pricing axis | Decision | Why |
|---|---|---|
| Per-seat? | [Avoid as primary] | Caps you at HR-budget logic. Margin vanishes. |
| Per-token? | [Avoid as primary] | Race to the bottom; commoditizes you alongside the LLM. |
| **Per-transaction take-rate** | [TARGET] | Aligns your revenue with user value. Compounds with volume. |
| Subscription (SaaS shell) | [Optional sidecar] | Predictable revenue floor; gates capacity not capability. |
| Settlement margin | [If applicable] | If you facilitate payment, take spread on float/conversion/settlement rail. |

**Sendero example (real, not theoretical):**
- Take-rate: % of GMV on bookings (`packages/billing/src/pricing.ts::confirm_booking.gmv.bps = 50` = 0.5%)
- Per-call meter: nanopayments at the tool layer (`MeterEvent`, `priceMicroUsdc`)
- Subscription: 4 plan tiers, gates workspace count + API keys + scope ceiling, NOT capability
- Settlement: USDC margin via Arc rails; per-tenant DCW spread

The two-leg model (take-rate + nanopay margin) is durable specifically because each leg defends against the other becoming commoditized.

---

## Section 4 — The agent itself (pulling from YC RFS)

### "AI-native, not copilot" (Alströmer RFS)

**Test:** strip the UI. Can the agent complete a job end-to-end with zero human-in-the-loop?

- [ ] Yes — keep building. You're agent-native.
- [ ] Only with a human approving each step — you've built a copilot. Reframe.
- [ ] Only the search/research half — you've built a SaaS feature. Reframe.

### "Software for agents, not for humans" (Epstein RFS)

The next trillion users on the internet won't be people. Every surface the agent uses should be:

- [ ] **Machine-readable interface** — APIs, MCP, CLI. Forms-and-buttons are second-class.
- [ ] **Self-service signup** — agents can discover, register, and start without a human. (Sendero: `/llms.txt`, `/api/openapi.json`, `/api/agent/identity` are all unauth or self-grant.)
- [ ] **Documentation as code** — every endpoint has a `.md` variant; every error has a `docsUrl` field.
- [ ] **Identity** — your agent has an ERC-8004 (or equivalent) identity that compounds reputation.

### "Closed loop, not open loop" (Diana Hu RFS)

Every operator decision should be queryable + automatable.

- Open loop: you make a decision, check the result manually weeks later
- Closed loop: system monitors → compares to expected → adjusts autonomously

Test: when a user's expectation diverges from reality, does your agent NOTICE within minutes, or does the user have to discover it themselves?

### "Make the company queryable" (Blomfield RFS, "Company Brain")

Your tenant has knowledge in:
- [ ] Slack threads
- [ ] Email accounts
- [ ] Past tickets / cases / trips
- [ ] Tribal knowledge in heads of senior operators

Your agent needs to ingest that into a queryable substrate. **Without this, the agent is asking the user every time.** The agent should know "we always upgrade VP-and-above to business class" without anyone telling it.

---

## Section 5 — Multi-channel distribution (compounding moat)

The same agent, available where users already are. Each channel adds users without changing the core:

- [ ] **Web app** — operator console
- [ ] **Slack / Microsoft Teams** — meet teams in their workflow
- [ ] **WhatsApp / SMS** — meet end-users in their phone
- [ ] **Email** — async fallback for everything
- [ ] **MCP server** — let other agents call your agent
- [ ] **Voice** — phone calls (still hard; ramps in 2026)

Each new channel is roughly free if your agent core is channel-agnostic (single tool registry, single persona, channel-shaped wrappers at the edges). Sendero's `runAgentTurn` proves the pattern: one engine, six channels.

---

## Section 6 — White-label and resale (the GTM expansion)

Once your agent is real, it can be resold:

- **Tier 1: Direct** — agent installed in end-customer's workspace. You're the brand.
- **Tier 2: Co-branded** — operator (TMC, agency, channel partner) installs into their customer's workspace. You're still the brand IN the workspace, but the operator owns the dashboard relationship + billing. Cheap and unblocks B2B2B GTM.
- **Tier 3: White-label** — operator installs THEIR OWN bot into their customer's workspace. You're invisible to the end-customer. Hard but high-ceiling: every operator becomes a customer-acquisition channel.

**Don't build Tier 3 on day 1.** Tier 2 unlocks the GTM motion with minimal infra. Stage your way up:
1. Direct
2. Per-tenant install URL (Tier 2 starter — Sendero's Stage 1)
3. Tenant brand fields on the install + dashboard (Tier 2 polish)
4. Per-tenant credentials + KMS + supply-side compliance story (Tier 3)

---

## Section 7 — Settlement rail (the differentiator a16z's post doesn't cover)

If your wedge moves money, control the rail. If it doesn't move money, find the adjacent transaction that DOES and build the rail:

- **On-chain settlement (USDC/USDT/EUR-stable)** — auditable, near-instant, low-fee. Sendero's choice for travel.
- **ACH / SEPA / Pix** — cheap but slow; programmable in 2026 via newer APIs.
- **Card rails** — expensive, fast, ubiquitous; useful for buyer-side capture, not seller-side disbursement.

The settlement rail is a moat dimension that compounds with the network: once thousands of buyers settle on your rail, the audit trail itself is differentiated value (compliance, treasury graph, fraud signal).

---

## Section 8 — Industries ripe for this template (a16z's list, expanded)

a16z called out these as fitting the agent → network thesis. Use this list as ICP filter:

- [ ] Industrial MRO (Heavi: truck repair shops)
- [ ] Agricultural inputs (Vereda: farmers)
- [ ] Freight and logistics
- [ ] Field services (HVAC, plumbing, electrical, landscaping)
- [ ] Food service procurement
- [ ] Construction subcontracting
- [ ] Healthcare staffing
- [ ] **Travel ops** (Sendero — TMCs, agencies, corporate travel desks)
- [ ] Insurance brokerage (Alströmer RFS)
- [ ] Accounting / tax / audit (Alströmer RFS)
- [ ] Compliance (Alströmer RFS)
- [ ] Healthcare administration (Alströmer RFS)
- [ ] Real estate transactions (high-frequency in some segments)
- [ ] Legal services (high-frequency in others)
- [ ] Recruiting (high-frequency, multi-supplier)

---

## Section 9 — Anti-patterns (skip these, they don't compound)

- ❌ **One-shot summarizer** — no transaction, no network data
- ❌ **Internal-only assistant** — no buyer × supplier graph
- ❌ **Generic horizontal AI tool** — no SKU, no price, no margin
- ❌ **Pure marketplace with humans transacting** — no agent, no automation moat
- ❌ **Slack bot for content generation** — no settlement, no network
- ❌ **Coding agent for one specific framework** — no commerce, no compounding

---

## Section 10 — Six-month execution checklist

Every box gets checked in the first 6 months, in roughly this order:

- [ ] **Month 1:** ship the agent wedge. One verticalized job, end-to-end, no human-in-the-loop.
- [ ] **Month 2:** ship the multi-channel surface. Web + at least one chat surface (Slack or WhatsApp) + MCP.
- [ ] **Month 3:** ship the per-transaction take-rate billing. Not seat-based.
- [ ] **Month 4:** ship the first network insight. "You paid X% above platform median" or equivalent.
- [ ] **Month 5:** ship Tier 2 GTM (per-tenant install URL, co-branded). Get one resale customer.
- [ ] **Month 6:** ship the supplier-side conversation. One supplier offers your network a preferred rate.

If month 6 ends and no supplier has approached you with "can we offer your network something special?", reread Section 2. The network isn't compounding yet.

---

## Section 11 — Founder forcing questions

These come from YC + Speedrun's hardest-hitting framing. Answer each in writing before raising your next round:

1. **Who, named, with a business card, gets promoted because of your product?** ("Users" is not an answer.)
2. **What's the smallest bundle of your buyers that moves a supplier's price by 5%?** (If you can't answer, you don't have demand-side leverage yet.)
3. **What does your dataset enable that nobody else's does?** (If the answer is "we have more users", you don't have a moat — you have a market share.)
4. **In 12 months, when an operator in your industry hears your name, what's the one sentence they say?** (If it's "they have a chatbot", you've failed.)
5. **What's the single fastest way you could lose your moat?** (Be honest. Then defend that vector.)
6. **If your product disappeared tomorrow, who panics first — buyers, suppliers, or operators?** (You want it to be "all three". If only one, you've built a feature, not a platform.)

---

## How to use this doc

1. Day 1 of a new vertical AI startup: copy this into the repo. Fill in every bracketed section.
2. Re-read at end of every milestone. Update the network signals + execution checklist.
3. When the next strategic decision comes up (pricing, channel, supplier deal): re-read Section 1-3 first.
4. Keep it in version control. The diff over time is your strategic story.

---

## References

- a16z Speedrun (2026): "Come for the Agent, Stay for the Network"
- Y Combinator Summer 2026 RFS: https://www.ycombinator.com/rfs
  - "AI-Native Service Companies" (Gustaf Alströmer)
  - "Software for Agents" (Aaron Epstein)
  - "AI Operating System for Companies" (Diana Hu)
  - "Company Brain" (Tom Blomfield)
  - "AI Personalized Medicine" (Ankit Gupta)
- Sendero internal: `CLAUDE.md` § "Wedge findings" for the in-repo applied version of this template.

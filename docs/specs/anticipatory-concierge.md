# Spec: Anticipatory concierge — experimental anticipation primitives, scored as buckets

**Status:** draft v0.3 · 2026-05-06 (Appendix A — full 152-tool experimental roadmap)
**Owner:** @criptopoeta
**Lead pattern:** `/bucket-analysis` (scorecard against current codebase) + `/raj-demand-driven-context` (loop tightening via Phoenix + Plurai) + the architectural bet (README §"The architectural bet")
**One-line:** Sendero's reactive concierge already ships. The next leg ships **anticipatory primitives behind an `experimental` flag** — starting with the **Hobby-Aware Concierge** (HP1) and **Monocle-Level Taste Engine** (HP2) that learn the traveler's taste graph and build personalized city packs before the traveler asks. Every primitive composes from already-shipped surfaces and feeds the Phoenix demand-driven loop, where Plurai evals score the rubric and `find_resolved_gap` closes drift.

**Changelog v0.3 (this revision):**
- **Appendix A — Full experimental tool catalog (152 tools)** added at the bottom of the spec. Source: `sendero_final_experimental_tool_roadmap.md` (v0.3 of the user's draft, integrated 2026-05-06).
- **HP3 — Romantic Concierge / Date Planner** added as the third highest-priority bucket (10 tools: date profile, budget optimizer, perfume advisor, plan builder/ranker, second-move finder, weather replan, route safety, pack builder). Score: 5% (greenfield; composes existing route + venue + weather primitives).
- **B1–B10 expanded from a summary table to detailed sections** with 152 tools total catalogued. Each tool gets a one-line purpose; high-priority tools (Phase 1 of "First 20 to build") get input/output schema sketches.
- **§16 NEW — API / data source setup**: Google stack ✅ wired; Eventbrite ✅ wired; Luma / Meetup / Ticketmaster / PredictHQ marked ⏳ pending (paid tiers / quota-sensitive).
- **§17 NEW — First 20 tools to build** (Phase 1 magic personalization → Phase 2 food + events → Phase 3 date planner). The minimum viable set that ships the killer demo: *"Build my personal city pack for Tokyo."*
- **Tool lifecycle model expanded** in Appendix A with `lifecycle: 'stable' | 'experimental' | 'deprecated'` enum + richer `ExperimentalMetadata` (anticipatory, hpBucket, minConfidence, requiresSourceAudit, travelerVisibleByDefault, phoenixEvalRubric). The §5 boolean `experimental` flag stays unchanged (autoplan-reviewed); the richer metadata is documented as the v0.4 evolution path when we have ≥10 experimental tools needing per-tool gates.
- **Phoenix span attributes expanded** — `sendero.research.confidence`, `.source_count`, `.official_source_count`, `.visual_signal_count`, `.budget_estimate_present`, `.audit_id` (per the roadmap's tool-lifecycle model).
- **HP3 thesis line added** to the README anticipation block.

**Changelog v0.2 (carried forward):**
- **HP1 NEW — Hobby-Aware Concierge / Traveler Taste Graph** added as the first highest-priority bucket. 15 tools spec'd (hobby profile, specialty coffee, work-from-cafe ranker, cheap Michelin, Bib Gourmand scanner, World's 50 Best researcher, foodie shortlist, Luma + Meetup + founder + networking discovery, city hobby pack, hobby map layer, bucket list manager, hobby concierge discover). Score: 18% (substrate composes existing `saveTravelerPreferenceTool` + `recommendRestaurantsTool` + `restaurantRouteCardTool` + `exportRouteMapTool` + `localColorBriefTool` + `getTripBriefTool`).
- **HP2 NEW — Monocle-Level Taste Engine** added as second highest-priority bucket. 10 tools spec'd (visual aesthetic scorer, budget estimator, monocle place researcher, beauty-budget ranker, ramen/wine-bar/bookstore/date-spot/local-design finders, city taste map builder). Score: 8% (Vision API integration + Michelin / 50 Best signal normalization + budget-estimation primitive all greenfield).
- **Phasing reordered.** Phase 1 = PR-A1 (flag) + PR-H1 (taste graph foundation) + PR-H2 (specialty coffee). Phase 2 = PR-H3/H4/H5 + PR-M1/M2/M3/M4. Original B1-B10 demoted to Phase 3.
- **New risks added** for Google Places/Luma/Meetup quota + cost, Vertex AI Vision per-image cost, Instagram API restriction (Meta 2024-12-04 deprecation — do NOT scrape), aesthetic-scoring subjectivity, supplier coverage gaps, taste-graph PII leakage, HP1 pre-arrival push consent.
- **Thesis line added** for HP2: "The difference between a directory and a concierge is judgment — and judgment requires visual taste, money awareness, and deep source research."

**Changelog v0.1 (carried forward):**
- 10 standard buckets (B1-B10) auto-generated via `/bucket-analysis`. Each scored 0–100% against actual codebase state.
- `experimental` flag introduced as a first-class field on `ToolDef`. Registry filtering, span attribute stamping, operator-dashboard badge, kill-switch env, auto-graduation criteria, find_resolved_gap weight.
- Phoenix integration: every experimental tool stamps `sendero.experimental_tool: true` on its OTel span.
- Plurai integration: 6 rubrics per primitive (canonical 4 + `intrusiveness` + `false_positive_rate`).

---

## 1. Problem statement

Today's Sendero agent reacts brilliantly to expressed intent. The Phoenix work (PR1–PR5, shipped on `whatsapp-e2e`) added recall + self-heal so the agent plans smarter and recovers from documented failures. **The bet is shipped at the *reactive* layer.**

The architectural bet ([README §"The architectural bet"](../../README.md)) is that the products that win 2026–2030 are the ones the user doesn't open. The mechanics of "doesn't open" are **anticipation**: the agent reaches out at the moment the user would have, with the answer already shaped to the context.

Three structural gaps between today's product and that bet:

1. **Reactivity is total.** Every traveler-facing turn starts with a human keyboard. Time-anchored, pattern-anchored, and drift-anchored signals all exist in the data but never drive outbound messages.
2. **Cross-trip pattern memory is read-only-at-turn-time.** Phoenix recall pulls past spans during a live turn. There is no surface that reads them at *sleep time* to pre-stage an offer for the next turn.
3. **Operator-side anticipation is manual.** Slack `#sendero-ops` gets human-typed updates, not agent-generated rollups. Operator-tier patterns (Monday rollup, batch visa checks, group-trip status) stay manual.

Each gap is composition of primitives already shipped. None requires new infrastructure construction. **What's missing is the wiring + the safety + the eval rubric**, not the substrate.

---

## 2. Goals

1. **Ship the `experimental` flag.** First-class field on `ToolDef`. Tools tagged `experimental` get registry filtering, span attribute, operator badge, per-tool kill switch, and a graduation criterion.
2. **Bucket-analysis scorecard.** 10 anticipation buckets, each scored 0–100% against the current codebase. Sequence by leverage × effort.
3. **Phoenix-loop integration.** Every experimental tool feeds the demand-driven loop. Trace stamps include `sendero.experimental_tool`. `find_resolved_gap` weights experimental drift higher (they're new; expect drift).
4. **Plurai evals per bucket.** Each anticipation primitive ships with a rubric draft. Six dimensions: locale fidelity, PII redaction, grounding, handoff trigger, **intrusiveness** (NEW), **false_positive_rate** (NEW).
5. **Auto-graduation.** Experimental tools that pass N successful turns + Plurai eval threshold auto-promote out of `experimental`. The flag is a phase, not a permanent label.

---

## 3. Non-goals

- **Replacing reactive concierge.** The new primitives are additive. No existing flow is removed; no existing tool changes shape.
- **New observability vendor.** Langfuse + Phoenix + Plurai already cover the three planes. The spec composes them.
- **Fully autonomous irreversible actions.** Every anticipation carries a `confirm | tweak | snooze` CTA. The agent never auto-completes booking, settlement, or cancellation on anticipated intent. That stays gated by the human.
- **New channels.** All anticipation flows through the existing four: WhatsApp, Slack, web, MCP. No push notifications, no email-as-primary, no SMS.
- **Calendar / Gmail integration in Phase 1.** Out of scope until consent + opt-in plumbing matures. Sketched in Phase 3.
- **Per-tenant prompt customization for anticipation tone.** Bucket 10 (safety/opt-out) is global; tenant-tone tuning is a v0.2 follow-up if pilots ask for it.

---

## 4. Bucket-analysis scorecard

Twelve anticipation buckets, each scored against actual code. **Score = how much of the bucket's substrate is already in the monorepo.** Higher score = less new construction; lower score = more work or consent/scope risk.

Two of the twelve are explicitly **highest-priority** — they ship before the standard B1–B10 sequence because they produce the strongest "magic" moments and compose cleanly with already-shipped tools (`saveTravelerPreferenceTool`, `recommendRestaurantsTool`, `restaurantRouteCardTool`, `exportRouteMapTool`, `localColorBriefTool`, `getTripBriefTool`). Both lift Sendero from a *trip-logistics agent* to a *taste-aware concierge* — the post-app thesis in its most personal form: the city comes to the traveler, already filtered by taste.

### 4.0 Highest-priority buckets

#### HP1 — Hobby-Aware Concierge / Traveler Taste Graph

**Score: 18%** — `saveTravelerPreferenceTool` + `recommendRestaurantsTool` + `restaurantRouteCardTool` + `exportRouteMapTool` + `localColorBriefTool` exist as the substrate; a structured taste graph and the orchestration layer that builds personalized city packs is greenfield. Google Places New + Luma/Meetup APIs are external integrations not yet wired.

**Why this comes first.** Flights, hotels, eSIMs, transfers and visas solve travel logistics. The hobby-aware concierge makes Sendero feel personally intelligent. The wedge:

> "Every city I visit, Sendero automatically builds my personal map: specialty coffee shops where I can work, affordable Michelin/Bib-style restaurants, founder/networking events, and local places that match my taste."

This is not a generic "things to do" feature. It's a persistent traveler taste layer that compounds across trips.

For example, for a typical Sendero traveler:
- specialty coffee
- cafés where they can work
- affordable Michelin / Bib Gourmand / 50 Best-style restaurants
- founder, AI, startup, web3 and professional networking events
- Luma / Meetup / Eventbrite discovery
- city-by-city bucket lists

Ships before broader experimental tools because it creates the fastest "magic" moment: *"Sendero knows what I love and builds my city before I ask."* And because it composes existing tools (no new booking integrations), it has the lowest external-API risk of any anticipation bucket.

**Product primitive: Traveler Taste Graph.**

```ts
type TravelerTasteGraph = {
  travelerId: string;
  hobbies: Array<{
    key:
      | 'specialty_coffee' | 'work_from_cafes' | 'cheap_michelin'
      | 'bib_gourmand' | 'worlds_50_best' | 'founder_networking'
      | 'ai_events' | 'web3_events' | 'meetups' | 'local_design'
      | 'bookstores' | 'wine_bars' | 'running' | 'gyms'
      | 'language_exchange' | 'art_galleries' | string;
    priority: 'low' | 'medium' | 'high';
    notes?: string;
    avoid?: string[];
    preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'late_night';
    preferredBudget?: 'budget' | 'medium' | 'premium' | 'no_limit';
  }>;
  cityBehavior: {
    prefersWorkingFromCafes?: boolean;
    likesRankedLists?: boolean;
    wantsTop50StyleShortlists?: boolean;
    likesNetworkingEvents?: boolean;
    likesLocalHiddenGems?: boolean;
    prefersOfficialSources?: boolean;
  };
  updatedAt: string;
};
```

Builds on the existing `saveTravelerPreferenceTool` (`packages/tools/src/save-traveler-preference.ts`); the graph is a typed view over preference rows + trip history + Phoenix recall + feedback. Storage: extend `TravelerProfile` with a typed `tasteGraph: Json` column OR introduce `TravelerTasteEntry` as a row-per-hobby table. Recommend the row-per-hobby table — easier to query, audit, and back out per-hobby.

**HP1 tool catalog (15 tools).** All ship behind `experimental: true`. Each tool is a thin layer over Google Places / Luma / Meetup / Sendero's existing primitives; the orchestrator (`hobby_concierge_discover`) hides the complexity from the LLM and surfaces a single high-level callable.

| # | Tool | Purpose | Primary external APIs | Composes |
|---|---|---|---|---|
| 1 | `hobby_profile_builder` | Create/update taste graph from explicit prefs + repeated behavior + saved places + feedback | none (DB-only) | `saveTravelerPreferenceTool`, trip history, Phoenix recall |
| 2 | `specialty_coffee_finder` | Find high-quality specialty coffee shops, especially work-friendly | Google Places (Text Search, Nearby, Details, Photos), Google Routes, Google Search | — |
| 3 | `work_from_cafe_ranker` | Rank café candidates specifically for working (WiFi, outlets, noise, hours) | Google Places Details, Google Routes | `specialty_coffee_finder` |
| 4 | `cheap_michelin_finder` | Affordable Michelin / Bib Gourmand / guide-level signal restaurants | Michelin Guide official, Google Places, Google Search, TheFork/OpenTable/Resy | — |
| 5 | `bib_gourmand_city_scanner` | Narrow scan for Bib Gourmand / good-value guide restaurants | Michelin Guide, Google Places | — |
| 6 | `worlds50best_nearby_researcher` | Detect 50 Best (Restaurants/Bars/Hotels) in a city | World's 50 Best official, Google Places | — |
| 7 | `foodie_shortlist_builder` | Combine all food signals into one personalized shortlist | — | tools 4, 5, 6 + Google Places + traveler taste graph |
| 8 | `luma_event_discovery` | Find Luma events matching traveler interests | Luma Public API + Google Search fallback | — |
| 9 | `meetup_event_discovery` | Find Meetup events by city + interests | Meetup GraphQL API + Google Search fallback | — |
| 10 | `professional_networking_scanner` | Aggregate networking-relevant events across providers | Eventbrite, Google Search, coworking calendars, accelerator websites | tools 8, 9 |
| 11 | `founder_event_finder` | Specifically founder-relevant events (demo days, VC panels, builder nights) | Same sources as 8/9/10 + university/VC newsletters | tools 8, 9, 10 |
| 12 | `city_hobby_pack_builder` | Build personalized city pack (orchestrator) | — | tools 1, 2, 3, 4, 7, 8, 9, 10, 13, 14 |
| 13 | `hobby_map_layer_builder` | Visual city map layer grouped by traveler hobbies | Google Places, Google Maps Static API or app map UI | — |
| 14 | `city_bucket_list_manager` | Save / love / skip / revisit city discoveries (taste graph feedback loop) | none (DB-only) | `hobby_profile_builder` |
| 15 | `hobby_concierge_discover` | Single high-level entry point that hides all complexity | — | tool 12 (and transitively, all of HP1) |

##### Tool detail (representative — full schemas in implementation PRs)

`hobby_profile_builder` input:
```ts
type HobbyProfileBuilderInput = {
  travelerId: string;
  tripId?: string;
  explicitPreferences?: string[];
  inferredSignals?: Array<{
    source: 'chat' | 'saved_place' | 'visited' | 'feedback' | 'booking' | 'manual';
    value: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
};
```

`specialty_coffee_finder` ranking criteria: real specialty signal (roaster, single-origin, espresso quality), work-friendly signal (WiFi, outlets, laptop mentions, noise level), opening hours, distance from hotel/current location, safety + after-dark suitability, traveler's saved taste graph.

`hobby_concierge_discover` example response:
> "Armé tu Tokyo pack: 9 cafés de especialidad buenos para trabajar, 5 restaurantes de alto valor y 3 eventos founder/AI esta semana. Para mañana empezaría con Koffee Mameya Kakeru de 9:30 a 12:00."

##### HP1 phased build order

| PR | Tools | Demo |
|---|---|---|
| **PR-H1** Taste Graph foundation | `hobby_profile_builder`, `city_bucket_list_manager`, `TravelerTasteGraph` schema, Phoenix spans for hobby inference | Save a preference; verify taste-graph row + Phoenix recall populates on next turn |
| **PR-H2** Specialty coffee wedge | `specialty_coffee_finder`, `work_from_cafe_ranker`, Google Places integration with field masks, coffee ranking rubric | "Find me the best specialty coffee shops to work from in Buenos Aires." |
| **PR-H3** Foodie wedge | `cheap_michelin_finder`, `bib_gourmand_city_scanner`, `worlds50best_nearby_researcher`, `foodie_shortlist_builder` | "Build my affordable Michelin-style list for Lima." |
| **PR-H4** Networking wedge | `luma_event_discovery`, `meetup_event_discovery`, `founder_event_finder`, `professional_networking_scanner` | "Find me founder/AI events this week in Buenos Aires." |
| **PR-H5** City hobby pack | `city_hobby_pack_builder`, `hobby_map_layer_builder`, `hobby_concierge_discover` | "Build my personal city pack for Tokyo." |

##### Why HP1 is highest priority

1. **Personally magical.** Sendero knows the traveler, not just the trip.
2. **Low dependency on travel suppliers.** No new booking integrations.
3. **Perfect for Google Places New.** Places + Routes + Search are enough for a powerful MVP.
4. **Demo material.** Every founder/investor/traveler instantly understands it.
5. **Naturally anticipatory.** "You land in CDMX tomorrow. I built your coffee + food + founder events map."
6. **Useful in every city.** The more someone travels, the more valuable it gets.
7. **A taste graph moat.** Saved places, loved spots, skipped venues and recurring hobbies become personalization data generic travel agents do not have.

---

#### HP2 — Monocle-Level Taste Engine

**Score: 8%** — Google Places photos are accessible; Vision API not wired; Michelin / 50 Best signals not normalized; budget-estimation primitive does not exist; Instagram API access is structurally constrained (see "Important Instagram note" below). Greenfield with several net-new primitives.

**Why this exists.** Recommendations need a *taste engine, not a directory*. The product should not just ask "is this place highly rated?" — it should ask "is this place beautiful, tasteful, worth the money, right for this traveler, and logistically sane?" That requires a Taste + Aesthetic + Budget engine, not just Google Places.

**Core idea — `taste_graph_recommender` formula:**

```
recommendationScore =
    qualitySignal
  + aestheticSignal
  + budgetFit
  + travelerTasteFit
  + logisticsFit
  - riskPenalty
```

For ramen, specialty coffee, dates, restaurants, bars, boutiques, museums, etc., Sendero evaluates:
- **Taste** — is this actually good?
- **Beauty** — does it look like a place you'd want to be?
- **Budget** — what will this probably cost?
- **Context** — is it right for the trip, time, weather, neighborhood, person?
- **Social proof** — Michelin, 50 Best, Google, local guides, blogs, reviews, creator posts
- **Visual proof** — photos, interior style, food plating, lighting, crowd

**Important Instagram note (autoplan-flagged constraint).** Meta shut down the old Instagram Basic Display API on 2024-12-04. Current Instagram API access is mainly through Instagram Graph API for Business/Creator accounts connected to Facebook Pages. **Do not build Sendero around unauthorized Instagram scraping** — brittle, legal/platform risk. Use a layered approach instead:

1. Official website + Google Places photos as the base visual source.
2. Instagram links discovered from official websites / Google profiles as references (link only, no scraping).
3. User-provided Instagram URLs when the traveler wants a specific place checked.
4. Approved third-party social data providers only if needed.
5. Vision analysis on accessible images to score aesthetic — not on private/scraped content.

Google Places already provides photos, ratings, opening hours, place metadata, and Maps URLs via Places API; Routes API handles travel time + logistics; Michelin's official guide is a high-signal source for restaurants (Bib Gourmand, selected restaurants, stars, hotels and editorial guidance).

**HP2 tool catalog (10 tools).** All ship behind `experimental: true`.

| # | Tool | Purpose | Primary external APIs | Composes |
|---|---|---|---|---|
| 1 | `visual_aesthetic_scorer` | Score how beautiful/tasteful a place looks from images | Google Places Photos + Vision API (Vertex AI Vision or equivalent) | traveler taste profile |
| 2 | `budget_estimator` | Estimate per-visit cost as a range, with assumptions | Google Places price level, menu pages, Michelin price symbols, reservation platforms, photo OCR, city cost index | — |
| 3 | `monocle_place_researcher` | Deep web researcher for one place — composes all signals into a single Sendero take | All HP2 sub-tools + Google Search | tools 1, 2, plus Michelin / 50 Best / local guide |
| 4 | `beauty_budget_ranker` | Rank candidates by beauty-per-dollar (the meta-tool) | — | tools 1, 2, 3 |
| 5 | `ramen_finder` | Specialized: serious ramen shops, queue-aware, taste-tagged | Google Places + Tabelog-like signal where available | tool 3 |
| 6 | `wine_bar_finder` | Specialized: serious wine bars, vibe-tagged | Google Places, Michelin where applicable | tool 3 |
| 7 | `bookstore_finder` | Specialized: independent + design-led bookstores | Google Places, local design press | tool 3 |
| 8 | `date_spot_finder` | Specialized: beautiful + budget-aware date spots | Google Places, reservation platforms | tools 1, 2, 4 |
| 9 | `local_design_shop_finder` | Specialized: design-led / independent retail | Google Places, local design press | — |
| 10 | `city_taste_map_builder` | **The killer tool.** One unified call that orchestrates the entire taste engine into a city map | — | all of HP2 + HP1's `hobby_map_layer_builder` |

##### Visual taxonomy (for `visual_aesthetic_scorer`)

```ts
type AestheticTag =
  | 'warm_lighting' | 'natural_light' | 'minimal' | 'old_world'
  | 'japanese_clean' | 'editorial' | 'romantic' | 'cozy'
  | 'design_forward' | 'beautiful_counter' | 'good_plating'
  | 'lush_greenery' | 'rooftop_view'
  // negative tags:
  | 'generic' | 'touristy' | 'fluorescent' | 'crowded'
  | 'soulless' | 'instagram_trap';
```

Every place gets visual annotations on its Phoenix span: `aestheticTags`, `negativeTags`, `bestFor` (`solo_lunch | date | deep_work | …`), `notFor` (`large_group | calls | …`).

##### Budget estimation discipline

Budget is several weak signals, never one perfect source. Output a *range*, never a fake exact number:

| Category | Example output |
|---|---|
| Restaurant dinner | "Expect $30–45/person normally. $70+ with wine." |
| Café | "Coffee + pastry: ~$7–12. Long work session with lunch: ~$18–25." |
| Date | "Medium version: ~$45–70/person across two spots." |
| Ramen | "Most likely $9–18 unless premium tasting-style." |

Signal sources composed: `googlePriceLevel`, `menuPricesFromWebsite`, `michelinPriceSymbols`, `reservationPlatformPrice`, `reviewMentions`, `photoMenuOCR`, `cityCostIndex`, `categoryDefaults`, `previousTravelerSpend`.

##### `city_taste_map_builder` — flagship

```ts
city_taste_map_builder({
  city: 'Tokyo',
  travelerId: 'tomas',
  budgetTier: 'medium',
  categories: ['ramen', 'specialty_coffee', 'cheap_michelin', 'date_spots', 'founder_events']
})
```

Returns a layered map (`Ramen under $20`, `Coffee to work from`, `Beautiful date spots`, `Founder events`) plus a `topMoveToday`:

> "Ramen counter tonight — $12–18 — high taste signal, beautiful counter, close to your hotel, open late."

##### Why HP2 ships second (not first)

HP2 depends on HP1's taste graph being populated for personalization to work. Run them in PR order: PR-H1 first (taste graph foundation), then PR-H2/H3 in parallel with the first HP2 PR (`monocle_place_researcher` + `budget_estimator`). `visual_aesthetic_scorer` is its own PR because the Vision API integration carries the most operational + cost risk.

##### HP2 thesis line

> Sendero should not recommend "the best places." It should recommend the best places **for your taste, your budget, your context, and the moment**. The difference between a directory and a concierge is *judgment* — and judgment requires visual taste, money awareness, deep source research, **as well as joie de vivre**.

---

### 4.1 Standard buckets (B1–B10)

| # | Bucket | Score | What's shipped | What's missing |
|---|---|---|---|---|
| **B1** | **Time-anchored triggers** — T-48h, T-2h, post-landing, +24h post-trip | **45%** | T-48h touchback ([commit `8f1ce14`](../../README.md)), workflow runtime ([`packages/workflows`](../../packages/workflows)), Vercel cron pattern ([`vercel.json`](../../vercel.json)) | `t_minus_2h_brief`, `post_landing_arrival`, `t_plus_24h_followup` workflow definitions; cron entries; persona slab |
| **B2** | **Pattern-anchored anticipation** — "you always book eSIM the day before" | **30%** | `TravelerProfile` ([Prisma schema](../../packages/database/prisma/schema.prisma)), Phoenix recall (`@sendero/arize-phoenix/recall`), trip history in `Trip` + `Booking` | A pattern-detector workflow that scans recall + history at sleep time; outbound trigger when match confidence > threshold |
| **B3** | **Drift anticipation** — supplier on-time history, hold-backup-option | **15%** | `trip-delay-replanner` tool exists; some supplier metadata in `Booking.metadata` | On-time aggregation primitive over `Booking`/`MeterEvent`; backup-hold workflow; supplier-risk score endpoint |
| **B4** | **Monday ops rollup** — Slack post to `#sendero-ops` summarizing tenant state | **55%** | Slack channel-send canonical ([`channel-send/slack.ts`](../../apps/app/lib/channel-send/slack.ts)), agent dispatch route, `/dashboard/handoffs`, group-trip dashboard | Cron + summary-generator workflow; persona slab for ops voice; opt-in tenant config (default off) |
| **B5** | **Group-trip confluence anticipation** — auto-broadcast at moment N/N visas cleared | **65%** | Group-trip primitive shipped ([`group-trips.ts`](../../packages/tools/src/group-trips.ts) + new dashboard), `broadcastToGroupTrip` tool | Trigger logic that watches state transitions; "all visas cleared" detector; persona slab for celebratory tone |
| **B6** | **Recovery anticipation** — proactive on detected delay or missed connection | **40%** | `tripDelayReplannerTool`, refund flows, `cancel_order_quote` family, settlement primitives | Delay-detection cron (Duffel webhook → workflow); proactive WhatsApp "your flight's delayed; here are 3 alternatives I'm holding" |
| **B7** | **Calendar / context signal** — Google Calendar / Slack DM events | **5%** | Nothing | OAuth consent flow, calendar pull, event-triggered workflows. **Phase 3 candidate.** |
| **B8** | **Cross-channel inactivity nudges** — in-thread reach-out if traveler stops responding | **20%** | Channel-send + session state ([`packages/agent/src/session.ts`](../../packages/agent/src/session.ts)) | Inactivity-detector workflow; persona for re-engagement nudge; per-tenant frequency cap |
| **B9** | **Anticipation observability panel** — operator dashboard surface | **35%** | `/dashboard/spend` Phoenix introspection strip pattern (PR5) | Mirrored strip for anticipation: triggers fired, positive replies, suppressions, opt-outs. Same component shape. |
| **B10** | **Anticipation safety / opt-out** — frequency cap, kill switch, per-traveler opt-out | **15%** | `TenantBroadcastOptOut` table for marketing-style opt-out | Per-traveler opt-out per `experimental` tool; daily/weekly cap; `SENDERO_EXPERIMENTAL_DISABLED_<TOOL>` env switch; ops dashboard toggle |

### Phasing by leverage × effort

| Phase | Buckets | Why |
|---|---|---|
| **Phase 1** (this spec) | B4 + B5 + B9 + B10 | Highest score (≥35%) means most substrate already shipped. B9 + B10 are cross-cutting and ride alongside any anticipation primitive — must land first or in parallel. |
| **Phase 2** | B1 + B2 + B6 | Medium score (~30–45%). Each composes from Phase 1 + adds a workflow definition + a cron. Each gets its own Plurai rubric. |
| **Phase 3 / deferred** | B3 + B7 + B8 | Score < 25% AND/or carries consent or new-infra risk. B3 needs aggregation primitive; B7 needs OAuth; B8 needs inactivity-detector + frequency cap proven. |

**Phase 1 = the experimental flag + B4 + B5 + B9 + B10.** Phase 1 alone proves the loop closes. Phases 2 and 3 are spec-then-ship later.

---

## 5. The `experimental` flag

A new optional field on `ToolDef`:

```ts
// packages/tools/src/types.ts
export interface ToolDef<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  jsonSchema: JsonSchemaObject;
  internal?: boolean;
  /**
   * Mark a tool as experimental. Five consequences flow from the flag:
   *
   * 1. **Registry filter.** Stripped from PRODUCTION prod-key catalogs
   *    by default. Sandbox keys see all experimental tools. Production
   *    sees them only when the tenant opts in via `Tenant.metadata
   *    .experimentalToolsEnabled[<toolName>] = true`. Override globally:
   *    `SENDERO_EXPERIMENTAL_FOR_PROD=1` (testnet-beta only).
   *
   * 2. **Span attribute.** Every invocation stamps
   *    `sendero.experimental_tool: true` on the OTel span via the same
   *    `traceAgent` mechanism that already stamps `sendero.tenant_id`.
   *    Phoenix queries can filter / count experimental traffic
   *    cleanly.
   *
   * 3. **Operator badge.** /dashboard/spend Phoenix strip + the new
   *    anticipation strip (Bucket B9) render an "experimental" pill
   *    next to the tool name. Operators see what's still in evaluation.
   *
   * 4. **Per-tool kill switch.** Env `SENDERO_EXPERIMENTAL_DISABLED_<TOOL>=1`
   *    flips the tool to `production_refused` regardless of caller. A
   *    panic button for any single primitive without a redeploy of the
   *    rest of the catalog.
   *
   * 5. **Auto-graduation.** A tool auto-flips to `experimental: false`
   *    when (a) it has logged ≥ 200 successful invocations across ≥ 5
   *    distinct tenants AND (b) its Plurai eval rubric is passing at
   *    ≥ 0.85 AND (c) its `report_knowledge_gap` rate is ≤ 2% over the
   *    last 30 days. Graduation is a PR (`experimental: false` flipped
   *    in the source); the metric is just the threshold to open the PR.
   *
   * find_resolved_gap weighting: gaps from experimental tools score
   * 1.5× similarity weight in the recall queue (newer surface = more
   * drift expected). The weight lives in
   * `packages/arize-phoenix/src/experiments.ts::scoreExample`.
   */
  experimental?: boolean;
  handler(input: I, ctx?: ToolContext): Promise<O>;
}
```

**Registry filter implementation.** A new helper in `packages/auth/src/dispatch-auth.ts`:

```ts
export function filterExperimentalTools(
  tools: ToolDef[],
  caller: { keyType: 'sandbox' | 'production'; effectiveKeyType: ... },
  tenantConfig: { experimentalToolsEnabled?: Record<string, boolean> }
): ToolDef[] {
  // Sandbox + dev: see everything
  if (caller.effectiveKeyType === 'sandbox') return tools;
  // Production prod-key: filter unless tenant opted into the specific tool
  return tools.filter(t => {
    if (!t.experimental) return true;
    return tenantConfig.experimentalToolsEnabled?.[t.name] === true;
  });
}
```

This composes with the existing `filterToolsByScopes` and `internal` flag — three layers of registry filtering, each defending a distinct concern (scope = capability, internal = surface visibility, experimental = maturity).

**Span attribute** is a one-line addition to `runAgentTurn` in `packages/agent/src/run.ts`. The existing `traceAgent` callback already has access to the tool name being invoked; we add the experimental-tool attribute at the same point we stamp `sendero.tenant_id`.

**Operator badge** is a 2-line conditional in [`apps/app/components/spend/phoenix-introspection-strip.tsx`](../../apps/app/components/spend/phoenix-introspection-strip.tsx) and the new bucket-B9 anticipation strip.

**Kill switch** is a one-line check at the top of each experimental tool's handler. Cheap, surgical.

**Auto-graduation** is a cron + a metric query against Phoenix + Postgres. Its outcome is a PR opened by an internal bot, not an automatic source mutation.

---

## 6. Architecture

The anticipation layer is a thin orchestration on top of primitives that already exist. Three runtime surfaces compose:

```
┌──────────────────────────────────────────────────────────────┐
│  WORKFLOWS (durable, paused/resumed, retry-aware)            │
│  packages/workflows/* + Vercel WDK                           │
│  - anticipation_trigger (NEW base workflow)                  │
│  - t_minus_48h_brief, monday_ops_rollup, group_confluence    │
│    (specific instantiations, each tagged `experimental`)     │
└─────────────┬────────────────────────────────────────────────┘
              │ workflow tick / cron / state-transition
              ▼
┌──────────────────────────────────────────────────────────────┐
│  ANTICIPATION TOOLS (experimental: true, dev/sandbox-only)   │
│  packages/tools/src/anticipation/*                           │
│  - generate_t48h_brief (composes weather + trip-state +      │
│    pre-staged options into one ChannelMessage)               │
│  - generate_monday_ops_rollup (queries tenant state, formats │
│    a Slack block-kit summary)                                │
│  - detect_group_confluence (reads GroupTrip state, fires     │
│    broadcast when threshold met)                             │
│  - check_anticipation_quota (B10 helper — frequency + opt-out)│
└─────────────┬────────────────────────────────────────────────┘
              │ ChannelMessage[] (canonical)
              ▼
┌──────────────────────────────────────────────────────────────┐
│  CHANNEL-RENDER + CHANNEL-SEND (already canonical, unchanged)│
│  apps/app/lib/channel-render/* + channel-send/*              │
│  - WhatsApp: interactive buttons (confirm/tweak/snooze)      │
│  - Slack: block-kit ops summary                              │
│  - web: card with primaryCta                                 │
└──────────────────────────────────────────────────────────────┘
              │
              ▼ (turn lands; spans flow to Phoenix + Langfuse)
┌──────────────────────────────────────────────────────────────┐
│  PHOENIX OBSERVABILITY (already wired)                       │
│  - sendero.experimental_tool: true on every span             │
│  - recall_similar_turns reads them like any other            │
│  - find_resolved_gap weights experimental gaps 1.5× higher   │
│  - phoenix-promote-successes cron auto-curates after 6h      │
└─────────────┬────────────────────────────────────────────────┘
              │ Plurai eval rubrics score the rubric
              ▼
┌──────────────────────────────────────────────────────────────┐
│  PLURAI (claude-code plugin, dev-side iteration)             │
│  - canonical 4 evals from the README                         │
│  - anticipation-specific: intrusiveness, false_positive_rate │
│  - locked rubrics promote to Langfuse evaluators             │
└──────────────────────────────────────────────────────────────┘
```

**Nothing in this diagram is new infrastructure.** Workflows are shipped. Tools registry is shipped. Channel-render + channel-send is shipped. Phoenix wiring is shipped. Plurai is documented. The anticipation tools and the workflow definitions are the only net-new surface.

### Why the demand-driven loop tightens *most* on experimental tools

Per `/raj-demand-driven-context`: the loop's compounding rate is proportional to how much novel drift the agent surfaces. Reactive tools have been hardened over months of production traffic. Experimental anticipation tools are brand-new — they will surface drift in:

- **Locale and tone** (proactive WhatsApp at T-48h needs different register from reactive replies)
- **Grounding** (anticipated offers must reference real live prices, not recalled-stale offers)
- **Frequency / intrusiveness** (a new failure mode: technically-correct messages that travelers find annoying)
- **PII** (anticipation pulls more context; redaction surface widens)

Every drift becomes a `report_knowledge_gap` row → eventually a `find_resolved_gap` resolution → recall data for the next anticipation turn. **Experimental anticipation pushes Phoenix harder than reactive concierge ever could**, because the surface is intentionally frontier. That's the leverage: high-volume novel drift, fast iteration, fast resolution, fast graduation.

---

## 7. Surfaces to touch (Phase 1 file-level)

```
packages/tools/src/types.ts                       ← + experimental field on ToolDef

packages/auth/src/dispatch-auth.ts                ← + filterExperimentalTools helper

packages/tools/src/anticipation/                  ← NEW directory
  generate_monday_ops_rollup.ts                   B4 — experimental: true
  detect_group_confluence.ts                      B5 — experimental: true
  check_anticipation_quota.ts                     B10 helper — experimental: true
  __tests__/                                       gate + happy/sad path tests

packages/tools/src/index.ts                       ← register 3 new tools in toolList

packages/workflows/src/                           ← NEW workflow definitions
  monday_ops_rollup.ts                            B4 cron entrypoint
  group_confluence_watcher.ts                     B5 state-watcher

apps/app/app/api/cron/                            ← NEW cron handlers
  anticipation-monday-rollup/route.ts             B4 — Mondays 9am tenant-local
  anticipation-group-confluence/route.ts          B5 — every 15 min

vercel.json                                       ← + 2 cron entries

packages/agent/src/run.ts                         ← stamp sendero.experimental_tool
                                                    on spans (1-line addition)

packages/database/prisma/schema.prisma            ← + AnticipationEvent table
                                                    (one row per fired trigger; powers
                                                    the operator strip + frequency cap)
                                                    + Tenant.metadata.experimentalToolsEnabled
                                                    + TravelerAnticipationOptOut table

apps/app/components/spend/                        ← NEW
  anticipation-introspection-strip.tsx            B9 — mirrors phoenix strip

apps/app/app/(app)/dashboard/spend/page.tsx       ← + render anticipation strip below
                                                    Phoenix strip

packages/arize-phoenix/src/experiments.ts         ← weight experimental gaps 1.5×
                                                    in scoreExample()

apps/app/lib/agent-persona.ts                     ← + anticipation persona slab:
                                                    "When a traveler reaches in to
                                                    confirm/tweak an anticipated
                                                    offer, treat it as if you reached
                                                    out — same locale, same tone,
                                                    same grounding rules."

docs/specs/anticipatory-concierge.md              this doc

README.md                                         ← + experimental flag doc + link
                                                    to this spec

apps/docs/                                        ← + /docs/anticipation page
                                                    (post-Phase-1)
```

**No changes** to: channel-render (already supports the `share` payload shape we'll use), channel-send orchestrators, Langfuse package, billing/x402/scopes, Circle/Arc settlement, Kapso workflows. Phase 1 stays inside the Sendero monorepo.

---

## 8. Phased rollout (PRs)

**Reordered from v0.1 to put HP1 ahead of B1–B10.** HP1 produces the strongest "magic" moment, composes from already-shipped tools, and has the lowest external-API risk. HP2 follows once HP1's taste graph is populated. The original B-prefixed PRs (A1/A2/A3) for B4/B5/B9/B10 stay on the schedule but yield priority slots to HP work.

**Phase 1 = PR-A1 + PR-H1 + PR-H2** (experimental flag plumbing + taste-graph foundation + specialty-coffee wedge). Three PRs, ~3 days, all visible in the demo recording.

**Phase 1B (parallel-track for the operator side) = PR-A2 + PR-A3.** Group-trip confluence + Monday ops rollup + observability strip + safety primitives. Ships on the same timeline because operator-side anticipation has zero customer-facing regulatory exposure (no WhatsApp Business policy concerns).

**Phase 2 = PR-H3 + PR-H4 + PR-H5** (foodie wedge + networking wedge + city hobby pack). HP1 reaches feature-complete.

**Phase 2.5 (HP2) = PR-M1 → PR-M4.** Visual scorer + budget estimator land first (Vision API integration carries cost + ops risk; gate behind a per-tenant budget cap). Then `monocle_place_researcher` + `beauty_budget_ranker` (the meta-tools). Then specialized finders (ramen / wine bar / bookstore / date spot / local design). Then `city_taste_map_builder` as the flagship.

**Phase 3 = original B1, B2, B6** (time-anchored expansion, pattern-anchored, recovery anticipation). Compose from Phase 1 + Phase 2's primitives.

**Phase 3.5 / deferred = B3, B7, B8** (supplier drift, calendar consent, cross-channel inactivity). Each carries its own consent or new-infra risk; revisit only after HP1 + HP2 produce real graduation candidates.

The detailed PR-H1 → PR-H5 build order is in §4.0 HP1. The PR-M1 → PR-M4 build order for HP2 is summarized below.

### Phase 1 — PRs in execution order

### PR-A1 — `experimental` flag plumbing (foundation)

**Goal:** ship the flag end-to-end with zero new anticipation tools using it yet. Validates that a future tool can opt in without infra work.

- `ToolDef.experimental` field
- `filterExperimentalTools` in dispatch-auth + wired into `/api/agent/dispatch` and `/api/mcp`
- `traceAgent` stamps `sendero.experimental_tool` on the OTel span
- `Tenant.metadata.experimentalToolsEnabled` schema field + Prisma migration
- `TravelerAnticipationOptOut` table + Prisma migration
- `AnticipationEvent` table (one row per triggered anticipation, status=`fired|positive|negative|suppressed`) + migration
- Phoenix find_resolved_gap weights `1.5×` for experimental traces (one constant + a comment)
- Unit tests for the filter (sandbox sees experimental; production-without-opt-in doesn't; production-with-opt-in does; kill-switch env wins)

**Eval gate.** `bun test packages/tools` + `bun test packages/auth` clean. No anticipation behavior changes.

### PR-A2 — Bucket B5: group-trip confluence broadcast (highest score, simplest demo)

**Goal:** the group-trip ships its first proactive moment.

- `detect_group_confluence` tool (experimental: true)
- `group_confluence_watcher` workflow (every 15 min, scoped to tenants with `experimentalToolsEnabled.detect_group_confluence`)
- Cron handler, vercel.json entry
- Persona slab line: "When a group trip transitions to all-visas-cleared, the broadcast voice is celebratory but operational — never gushy."
- Plurai eval rubric draft: locale + intrusiveness + grounding + handoff
- Adversarial test: planted trigger condition fires the broadcast; opt-out suppresses it; frequency cap suppresses repeat fires
- Demo script: a sandbox tenant's group trip moves to all-cleared → operator sees Slack broadcast 60s later → they confirm in `#sendero-ops` → traveler-side WhatsApp lands with the confluence message + confirm/tweak/snooze CTA

**Eval gate.** Plurai rubric scores ≥ 0.85 on the 4 canonical + 2 anticipation evals. Frequency-cap regression test passes.

### PR-A3 — Bucket B4 + B9 + B10: Monday ops rollup + observability strip + safety primitives

**Goal:** operator-facing surface lights up; safety lands alongside.

- `generate_monday_ops_rollup` tool (experimental: true)
- `monday_ops_rollup` workflow (Mondays 9am tenant-local; opt-in)
- `check_anticipation_quota` helper (frequency cap + per-traveler opt-out)
- `/dashboard/spend` anticipation introspection strip (mirrors Phoenix strip pattern; 4 tiles: triggers fired this week, positive replies, suppressed by quota, suppressed by opt-out)
- Workspace-level kill switch UI in `/dashboard/spend` (admin-role-gated)
- README anticipation section + link to this spec
- Plurai rubric for the rollup voice (operator-tone) + intrusiveness eval (Mondays at 9am only)

**Eval gate.** Strip renders correctly with seeded `AnticipationEvent` rows. Kill-switch flips behavior. 6 anticipation evals on Plurai score ≥ 0.85.

### Phase 2 — HP1 feature-complete + HP2 starts

- **PR-H3** Foodie wedge (`cheap_michelin_finder`, `bib_gourmand_city_scanner`, `worlds50best_nearby_researcher`, `foodie_shortlist_builder`)
- **PR-H4** Networking wedge (`luma_event_discovery`, `meetup_event_discovery`, `founder_event_finder`, `professional_networking_scanner`)
- **PR-H5** City hobby pack (`city_hobby_pack_builder`, `hobby_map_layer_builder`, `hobby_concierge_discover`)

### Phase 2.5 — HP2 Monocle-Level Taste Engine

- **PR-M1** Visual scorer + budget estimator (`visual_aesthetic_scorer`, `budget_estimator`). Vision API + price-signal pipeline. **Per-tenant Vision budget cap mandatory** (Vertex AI Vision charges per image; one runaway tenant could spike spend).
- **PR-M2** `monocle_place_researcher` + `beauty_budget_ranker` (the meta-tools that compose all HP2 sub-signals).
- **PR-M3** Specialized finders (`ramen_finder`, `wine_bar_finder`, `bookstore_finder`, `date_spot_finder`, `local_design_shop_finder`).
- **PR-M4** `city_taste_map_builder` flagship.

### Phase 3 — original B-buckets (deferred sketch)

- B1 — time-anchored expansion (`t_minus_2h_brief`, `post_landing_arrival`, `t_plus_24h_followup`)
- B2 — pattern-anchored anticipation (Phoenix recall at sleep time → cross-trip pattern detector → outbound trigger)
- B6 — recovery anticipation (Duffel webhook → delay-detector → proactive replanner offer)

### Phase 3.5 (deferred / consent-gated)

- B3 — drift anticipation (supplier on-time aggregation primitive)
- B7 — calendar / context signal anticipation (OAuth + calendar pull + event-triggered workflows)
- B8 — cross-channel inactivity nudges (inactivity detector + per-tenant frequency cap proven)

---

## 9. Test / eval plan (Plurai-driven, Phoenix-verified)

### New Plurai rubrics (drafted in claude-code via `/evals:eval`)

```bash
# In addition to the existing 4 canonical evals (locale / PII / grounding /
# handoff), draft these two for every anticipation primitive:

/evals:eval intrusiveness — anticipation messages must score "appropriate"
or "useful" on a 5-point Likert scale. Penalize messages that fire when the
traveler did not consent (TravelerAnticipationOptOut row exists), when the
frequency cap was already hit this week, or when the traveler's last
inbound said "stop" / "leave me alone" / "not now" or equivalent in any
supported locale.

/evals:eval false_positive_rate — anticipated content must reflect REAL
trip state. Penalize messages that reference flight numbers, gates, hotel
names, or prices that were not pulled from a tool call in the same workflow
execution. Same shape as the existing `grounding` eval but scoped to
proactively-pushed content where stakes are higher (the traveler didn't
ask, so wrong content is more jarring).
```

### Sendero-golden-turns additions

Add 4 scenarios specifically for Phase 1:

- `anticipation-group-confluence-fires` — planted state transition; expect broadcast within 60s
- `anticipation-group-confluence-respects-optout` — same state, traveler opt-out present; expect no broadcast
- `anticipation-monday-rollup-quota` — second rollup attempt within the same week; expect suppression with `AnticipationEvent.status='suppressed_quota'`
- `anticipation-experimental-flag-prod-refuses` — production prod-key without tenant opt-in; expect catalog filter strips the experimental tools

### Adversarial tests

- Plant a malicious AnticipationEvent state-update via a leaked dev key → confirm production gate refuses
- Send a flood of fake state transitions → confirm rate-limit clamps the workflow
- Plurai rubric drift: same scenario, two model versions → confirm rubric scores stay within 0.05 of each other (tightens the eval rubric itself before promotion to Langfuse)

---

## 10. GTM motions (`/gtm-motions` aligned)

Anticipation is a **PLG-led** play. The proactive trigger IS the wow moment that gets forwarded inside a tenant.

| Motion | Score | How anticipation plays |
|---|---|---|
| **PLG** (primary) | 9/10 | Proactive triggers are screenshot-ready. Operator forwards to TMC owner. Owner forwards to next TMC. The product sells itself. |
| **Partner** (primary) | 9/10 | Joint Arize blog: "Pushing Phoenix to its limits — anticipation's high-volume novel drift as the test bed." Vercel WDK joint: "Durable anticipation triggers on Workflow DevKit." Plurai joint: "Eval rubrics for proactive AI agents — intrusiveness as a first-class metric." |
| **Inbound** (secondary) | 7/10 | One technical post: "Anticipation as a primitive — building the proactive concierge on already-shipped infra." Bait keywords: `proactive AI agent`, `anticipation observability`, `experimental tool flag`. |
| **ABM** (secondary) | 7/10 | Replaces "look at the agent answering" demo with "look at the agent reaching out at the right moment, every time, before the traveler asks." |
| **Community** | 4/10 | Modest. The Plurai-rubric authoring patterns become open-source recipes. |
| **Outbound** | 4/10 | Founder-led, narrow. Anticipation video clips are the asset. |
| **Paid Digital** | 1/10 | Premature. |

**90-day stack:**
- Week 1–2: PR-A1 + PR-A2 land. Pilot tenant flagged for B5.
- Week 3: PR-A3 lands (B4 + B9 + B10). Same pilot tenant flagged for B4. Anticipation strip live.
- Week 4: First TMC sales call leads with the warm-vs-cold + reactive-vs-proactive demo.
- Week 6: Joint Arize post drafted (post-hackathon publish window).
- Week 8: Plurai joint post on intrusiveness as an eval primitive.

---

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Travelers find anticipation creepy / annoying | Plurai `intrusiveness` rubric scores every message. Frequency cap (`check_anticipation_quota`). Per-traveler opt-out (`TravelerAnticipationOptOut`). Default-off for production tenants. |
| Anticipated content references stale prices | Plurai `false_positive_rate` rubric. Persona slab: "Anticipation is a hint that you should re-fetch live state. Never quote a price unless you re-quoted it in the same workflow execution." |
| Frequency cap silently swallows urgent messages | `AnticipationEvent.status='suppressed_quota'` rows surface in the operator strip. High-severity triggers (delay > 4h, settlement issue) bypass the cap by class. |
| Experimental tools accidentally reach customer-facing channels in prod | Three-layer filter (`internal`, `experimental`, scope). Production prod-key tenant must opt in per-tool. Kill-switch env per tool. Phoenix span attribute is queryable for audits. |
| Auto-graduation flips a tool prematurely | Graduation is a PR, not auto-source-mutation. Threshold (≥200 turns, ≥5 tenants, ≥0.85 eval, ≤2% gap rate) is restrictive on purpose. |
| Phoenix recall returns experimental traces and biases reactive turns | Recall filter strips spans where `sendero.experimental_tool=true` for production callers by default. Sandbox callers see them. Tenant opt-in flips the default. |
| Cron at scale hits Phoenix Cloud rate limits | PR1 already shipped self-host docker-compose. B4 is bounded (one rollup per tenant per week); B5 watcher is bounded (one fire per group-trip per state transition). Per-cron metrics in the operator strip. |
| Plurai rubric drift across model versions | Rubric stability test in §9. Locked rubrics promote to Langfuse evaluators where score history is durable. |
| **HP1/HP2 — Google Places / Luma / Meetup API quotas + cost** | Per-tenant + per-tool daily call cap enforced in `check_anticipation_quota`. Cache discovered places per `(city, category)` for 24h. Plurai rubric tracks "queries per traveler per day" to detect runaway loops. |
| **HP2 — Vertex AI Vision per-image cost** | Mandatory per-tenant budget cap. `visual_aesthetic_scorer` skips images already scored in last 30 days (cache `(placeId → aestheticTags)` in Phoenix dataset `sendero-aesthetic-cache`). Hard cap: 100 images/tenant/day in Phase 2.5; revisit after first paying TMC. |
| **HP2 — Instagram API restriction (Meta deprecated Basic Display API 2024-12-04)** | **Do not scrape Instagram.** Use only: official websites + Google Places photos as primary visual source; Instagram URLs as discovered links, not scraped content; user-provided IG URLs when traveler explicitly checks a place; approved third-party social-data providers if needed. Vision analysis on accessible images only. Documented in §4.0 HP2 "Important Instagram note." |
| **HP2 — Visual aesthetic scoring is subjective by definition** | Plurai `intrusiveness` + a new `aesthetic_alignment` rubric (does the visual tag match what the traveler said they liked?) with traveler-facing "reject this score" feedback. Taste graph stores rejections so the LLM-as-judge learns calibration. |
| **HP1/HP2 — Supplier / restaurant / event coverage gaps in cities outside primary markets** | Acknowledge in product copy: "I couldn't find specialty coffee data for [small city] — happy to use whatever you've already saved as your starting point." Don't over-promise. Phoenix `report_knowledge_gap` rate per `(city, category)` becomes a coverage signal. |
| **HP1 — Taste graph PII leakage on cross-tenant agent calls** | Taste graph is `User`-scoped, not tenant-scoped. Cross-tenant scope filter on `hobby_profile_builder` reads/writes. Test in §9: tenant-A traveler taste graph never reaches tenant-B agent calls. |
| **HP1 traveler-side push for "arrival pack" pre-departure** | Same WhatsApp Business policy concern as B5. Deferred to Phase 2 with Meta template-category review. Phase 1 `hobby_concierge_discover` is **pull-shaped only** — traveler asks, agent answers. No pre-arrival pushes until consent UX ships. |

---

## 12. Open questions

1. **Tenant opt-in default — opt-in vs opt-in-by-tier?** Recommend per-tier default: Free + Basic = opt-in only; Pro = opt-in for B5 by default; Enterprise = opt-in for B4 + B5 by default. Surface in the billing tier feature matrix.
2. **Anticipation persona — single voice vs per-tenant?** Recommend single Sendero voice for v0.1 (consistent demo). Tenant-tone customization is v0.2 if pilots ask.
3. **Where does the auto-graduation cron live — Vercel cron or Trigger.dev?** Trigger.dev is already wired (per CLAUDE.md). Recommend Trigger.dev so the graduation logic can pause/resume on Plurai eval availability.
4. **`experimental` flag's effect on x402 metering — same price as production tools?** Recommend free during experimental phase (sandbox metering only). Graduates to standard price-cells on flag flip. Aligns with the testnet-beta downgrade pattern in CLAUDE.md.
5. **Group-trip confluence trigger — first-fire vs every-state-change?** Recommend first-fire only (idempotency on `(groupTripId, triggerKind)`). State changes that re-trigger after an explicit reset are out of scope for v0.1.

---

## 13. What I need from you (one-shot, before PR-A1 starts)

- [ ] **Resolve the 5 open questions above** (or tell me which to defer).
- [ ] **Approval to proceed** with PR-A1 (foundation, no anticipation behavior changes).
- [ ] **Pilot tenant pick** — which sandbox tenant gets flagged for B5 and B4 in week 2/3? Recommend a tenant with an active group trip.

PR-A1 ships in ~half a day from approval. PR-A2 ships in ~1 day after that. PR-A3 ships in ~1.5 days. Phase 1 total ~3 days. Phase 2 spec drops once Phase 1 hits eval thresholds.

---

## 14. Reference

- This spec's lead patterns: `/bucket-analysis` + `/raj-demand-driven-context`.
- Architectural bet framing: [`README.md` → "The architectural bet — post-app, agent-native, MCP-first"](../../README.md).
- Phoenix companion spec: [`docs/specs/arize-phoenix-integration.md`](./arize-phoenix-integration.md) (v0.4).
- Skill: [`/raj-demand-driven-context`](~/.claude/skills/raj-demand-driven-context/SKILL.md) — three providers + four agent tools + the demand-driven loop.
- Plurai claude-code plugin: `evals@plurai-plugins`.
- CLAUDE.md sections: "Demand-driven context (Raj's pattern, dev-only)" + "Observability + prompt management — Langfuse" + "Mainnet cutover gating — distribution surfaces".
- Workflow runtime: [`packages/workflows/`](../../packages/workflows) + Vercel WDK.
- Channel-render layer: [`apps/app/lib/channel-render/`](../../apps/app/lib/channel-render).
- Phoenix recall: [`@sendero/arize-phoenix/recall`](../../packages/arize-phoenix).

---

## Appendix A — Full experimental tool catalog (v0.3)

> Source: `sendero_final_experimental_tool_roadmap.md` (founder draft v0.3, integrated 2026-05-06). Preserves the founder's tool naming + input/output sketches. The §1–§14 architecture above is the meta-spec; this appendix is the implementer-facing catalog of 152 tools.

### A.1 Core thesis

A directory says: *"Here are restaurants near you."*
A travel app says: *"Here are top-rated restaurants."*
**Sendero says: *"For your taste, your budget, tonight's weather, your hotel, and the energy you want, this is the move."***

The experimental concierge roadmap prioritizes tools that produce **judgment**: taste, beauty, budget, routing, vibe, confidence, context, timing, source quality, traveler memory.

### A.2 Existing stable base (do not duplicate)

Sendero already has: flights, hotels, eSIM, wallet, FX, restaurants, route maps, transfers, airport arrival, weather, air quality, elevation, timezone, travel safety, visas, document scanning, group trips, TripPassport / NFT, match fixtures, tipping, local color, delay replanner, check-in reminders, trip brief, traveler preference persistence. The 152 tools below are a higher-level **experimental layer** for personalization, discovery, taste, budget-awareness, and anticipation — not replacements for the stable base.

### A.3 Tool lifecycle model (v0.4 evolution path)

```ts
type ToolLifecycle = 'stable' | 'experimental' | 'deprecated';

type ExperimentalMetadata = {
  anticipatory: boolean;
  hpBucket?: 'HP1' | 'HP2' | 'HP3' | 'HP4';
  bucket: string;
  minConfidence?: 'low' | 'medium' | 'high';
  requiresSourceAudit?: boolean;
  travelerVisibleByDefault?: boolean;
  phoenixEvalRubric?: string;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: unknown;
  lifecycle?: ToolLifecycle;
  experimental?: ExperimentalMetadata;
};
```

**v0.3 keeps the §5 boolean `experimental` flag** as the autoplan-reviewed primitive. The richer `ExperimentalMetadata` becomes the **v0.4 migration target** once we have ≥ 10 experimental tools that need per-tool eval rubrics, confidence floors, or visibility gates.

**Default experimental behavior:**
- `travelerVisibleByDefault = false`
- writes Phoenix span attributes
- writes source audit trail when using web/search/visual data
- produces confidence score
- can be used by stable tools as middleware
- not automatically exposed to public MCP/API callers
- may power traveler-facing cards only after passing policy checks

**Phoenix span attributes (v0.4 expanded set):**

```
sendero.tool.lifecycle              experimental
sendero.experimental.bucket         HP1 | HP2 | HP3 | B1 | …
sendero.experimental.anticipatory   true | false
sendero.research.confidence         low | medium | high
sendero.research.source_count       <number>
sendero.research.official_source_count   <number>
sendero.research.visual_signal_count     <number>
sendero.research.budget_estimate_present  true | false
sendero.research.audit_id           <string>
```

---

### A.4 HP1 — Hobby-Aware Concierge / Traveler Taste Graph (23 tools)

Tools 1–23. Builds on existing `saveTravelerPreferenceTool` + `recommendRestaurantsTool` + `restaurantRouteCardTool` + `exportRouteMapTool` + `localColorBriefTool` + `getTripBriefTool`. The taste graph is a typed view (recommend row-per-hobby table `TravelerTasteEntry` over JSON column).

```ts
type TravelerTasteGraph = {
  travelerId: string;
  hobbies: Array<{
    key: 'specialty_coffee' | 'work_from_cafes' | 'cheap_michelin' | 'bib_gourmand'
       | 'worlds_50_best' | 'ramen' | 'founder_networking' | 'ai_events'
       | 'web3_events' | 'meetups' | 'date_spots' | 'bookstores'
       | 'wine_bars' | 'record_stores' | 'running' | 'gyms'
       | 'language_exchange' | 'art_galleries' | 'local_design' | string;
    priority: 'low' | 'medium' | 'high';
    notes?: string;
    avoid?: string[];
    preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'late_night';
    preferredBudget?: 'budget' | 'medium' | 'premium' | 'splurge' | 'no_limit';
  }>;
  cityBehavior: {
    prefersWorkingFromCafes?: boolean;
    likesRankedLists?: boolean;
    wantsTop50StyleShortlists?: boolean;
    likesNetworkingEvents?: boolean;
    likesLocalHiddenGems?: boolean;
    prefersOfficialSources?: boolean;
    likesBeautyPerDollar?: boolean;
  };
  updatedAt: string;
};
```

| # | Tool | Purpose | Notes |
|---|---|---|---|
| 1 | `hobby_profile_builder` | Build/update taste graph from explicit prefs + inferred signals | Do NOT infer sensitive personal attributes. Travel-relevant prefs only. Traveler can correct ("Too fancy", "Less touristy", "Actually I don't like loud cafés"). |
| 2 | `city_bucket_list_manager` | Save / love / skip / revisit / recommend-to-friend feedback loop | Every save/love/skip improves future ranking. |
| 3 | `hobby_concierge_discover` | High-level orchestration (`mode: arrival_pack | today | tomorrow | work_from_cafe | foodie | networking | map | build_city_list`) | Single entry point that hides HP1 complexity from the LLM. |
| 4 | `city_hobby_pack_builder` | Build complete city pack composing all HP1 sub-tools | Composes #1, #6–12, #47–48, #50, #5 (map layer), #2 (bucket list). |
| 5 | `hobby_map_layer_builder` | Map layers grouped by hobby (coffee / work cafés / ramen / Michelin / Bib / 50 Best / events / dates / bookstores / wine bars / record stores / local design / nightlife / local gems) | — |
| 6 | `specialty_coffee_finder` | Specialty coffee shops + roasters; signals: roaster, single-origin, espresso quality, coffee-focused reviews, photos, hours, distance, taste graph | Google Places + Routes + Custom Search; optional Sprudge / European Coffee Trip / local blogs. |
| 7 | `work_from_cafe_ranker` | Rank cafés specifically for working: WiFi, outlets, quietness, table comfort, calls, long-stay, food, espresso, distance | Consumes #6 candidates; produces 1 best + alternatives + avoid list. |
| 8 | `cheap_michelin_finder` | Affordable Michelin / Bib / guide-level: lunch menu, à la carte strategy, reservation availability, expected spend | Michelin Guide + Google Places + Search + TheFork/OpenTable/Resy redirect. |
| 9 | `bib_gourmand_city_scanner` | Narrow scan for Bib Gourmand / good-value guide restaurants | Sub-tool of #8. |
| 10 | `worlds50best_nearby_researcher` | Detect 50 Best restaurants/bars/hotels (regional lists too) | World's 50 Best + Latin/Asia/MENA 50 Best official sources. |
| 11 | `foodie_shortlist_builder` | Combine Michelin + Bib + 50 Best + Places + local guides + menus + taste graph + #25 budget + #24 visual scorer | Orchestrator; output is a personalized food list. |
| 12 | `ramen_finder` | Specialized ramen: style, price, local rep, queue, counter vibe, visual bowl, guide signals, distance, hours, beauty-per-dollar | Tabelog signal where available. |
| 13 | `bookstore_finder` | Independent / cafés-librerías / rare / beautiful bookshops | — |
| 14 | `wine_bar_finder` | Wine bars by taste, budget, date suitability, beauty, route | Composes with #28 beauty-budget ranker for date use. |
| 15 | `record_store_finder` | Vinyl / music shops / local music culture spots | — |
| 16 | `local_food_market_finder` | Food markets, street food, gastronomic halls, farmers markets | — |
| 17 | `language_exchange_finder` | Low-pressure social events for language practice | Mostly Meetup-sourced. |
| 18 | `running_route_finder` | Safe + scenic running routes near hotel/current location | Composes Google Routes + safety briefs. |
| 19 | `gym_day_pass_finder` | Gyms with day passes near hotel | — |
| 20 | `yoga_pilates_class_finder` | Drop-in yoga / pilates / wellness classes | ClassPass signal where applicable. |
| 21 | `art_gallery_opening_finder` | Gallery openings, museum nights, art fairs, vernissages | — |
| 22 | `hiking_day_trip_finder` | Day hikes + nature escapes near a city | — |
| 23 | `photography_spot_finder` | Golden hour spots, viewpoints, street photography areas, beautiful corners | — |

---

### A.5 HP2 — Monocle-Level Taste Engine (6 tools)

The judgment layer. Decides whether a candidate from HP1 is *actually good*.

```
recommendationScore =
    qualitySignal
  + aestheticSignal
  + budgetFit
  + travelerTasteFit
  + logisticsFit
  - riskPenalty
```

| # | Tool | Purpose | Notes |
|---|---|---|---|
| 24 | `visual_aesthetic_scorer` | Score how beautiful/tasteful a place looks from accessible images | Vertex AI Vision. **No Instagram scraping** (Meta deprecated Basic Display API 2024-12-04). Use Places photos + official websites + user-provided URLs only. |
| 25 | `budget_estimator` | Likely spend per visit as a *range* — never fake exact numbers | Composes Google price level + menu OCR + Michelin price symbols + reservation platforms + city cost index + previous traveler spend. Output: `{ low, typical, high, currency, budgetTier, assumptions[], moneyTalk }`. |
| 26 | `monocle_place_researcher` | Deep-research one place: official site, Places, photos, menu, reservation, Michelin/50 Best/local guide mentions, social, reviews, hours, price, vibe, overrated check | The Monocle voice — produces `senderoTake` text. |
| 27 | `beauty_budget_ranker` | Rank by **beauty-per-dollar** | The HP2 meta-tool. |
| 28 | `city_taste_map_builder` | Complete taste map for a city (the killer tool) | Layered: Ramen under $20 / Coffee for work / Beautiful date spots / Founder events / etc + `topMoveToday`. |
| 29 | `taste_feedback_loop` | Learn from saved / skipped / loved / visited / "too expensive" / "too touristy" / "beautiful but not worth it" / "exact vibe" / "bad lighting" / "too loud" / "too formal" / "too generic" | Closes the recommendation loop. |

**Aesthetic taxonomy** (positive + negative tags): `warm_lighting`, `natural_light`, `minimal`, `old_world`, `japanese_clean`, `editorial`, `romantic`, `cozy`, `design_forward`, `beautiful_counter`, `good_plating`, `lush_greenery`, `rooftop_view`, `generic`, `touristy`, `fluorescent`, `crowded`, `soulless`, `instagram_trap`.

---

### A.6 HP3 — Romantic Concierge / Date Planner (10 tools)

A great date is a sequence: low-pressure opener → main anchor → optional second move → graceful exit / safe route home. The planner must be budget-aware, vibe-aware, weather-aware, route-aware, safety-aware, visually tasteful, confidence-building.

**Budget tiers:**
- `budget` — coffee + gallery + walk; casual food + free event. ~$25–40/person.
- `medium` — good restaurant + cocktail/wine bar; paid event + casual dinner. ~$40–90/person.
- `premium` — excellent restaurant + proper cocktail bar; Michelin-adjacent dinner + jazz/theater/rooftop. ~$90–180/person.
- `splurge` — tasting menu, luxury bar, private experience, premium tickets. Only if explicitly requested.

| # | Tool | Purpose | Notes |
|---|---|---|---|
| 30 | `date_profile_builder` | Capture dating prefs + constraints | **Do NOT infer sensitive romantic/sexual traits.** Store: budget, vibe, avoid, preferred date length, preferred first move, quiet/loud, casual/fancy. |
| 31 | `date_budget_optimizer` | Translate desired vibe into options by budget tier | Composes #25 budget estimator + #28 city taste map. |
| 32 | `date_game_tips` | Tasteful, respectful, confidence-building advice | **Allowed:** confidence, conversation, timing, second moves, graceful exits, consent-aware. **Not allowed:** manipulation, pickup-artist tactics, sexual pressure, gender stereotypes, creepy personalization. |
| 33 | `date_perfume_advisor` | Fragrance advice (day vs night profiles) | Day: citrus / tea / light woods / neroli / subtle musk / green-fresh. Night: warm woods / amber / soft vanilla / light tobacco / elegant musk / spicy citrus. Rule: *discovery, not announcement.* |
| 34 | `date_plan_builder` | Multi-stop date plan with timeline roles (`opener | anchor | second_move | exit`) | — |
| 35 | `date_plan_ranker` | Generate multiple candidate plans + rank by vibe fit, budget, distance, weather resilience, conversation ease, second-move quality, formality match, exit grace | — |
| 36 | `date_second_move_finder` | Find the perfect optional second move near the anchor | Options: dessert / wine bar / cocktail / walk / viewpoint / music / bookstore / late coffee. |
| 37 | `date_weather_replan` | Adjust plan based on rain / heat / cold / wind | — |
| 38 | `date_route_safety_check` | Route smoothness + safety between date spots | Composes existing safety tools. |
| 39 | `romantic_city_pack_builder` | Date plans by budget tier (one pack per tier) | Top-level orchestrator for HP3. |

---

### A.7 B1 — Research Infrastructure (7 tools)

Every experimental tool depends on source quality + auditability.

| # | Tool | Purpose |
|---|---|---|
| 40 | `official_source_resolver` | Find authoritative sources: official venue page, airport, government, museum, restaurant, ticketing, airline, embassy. |
| 41 | `source_confidence_scorer` | Score sources by authority, freshness, locality, specificity, contradiction risk, category fit. |
| 42 | `research_audit_trail` | Store *why* Sendero recommended something. |
| 43 | `source_cache_manager` | Cache research by city × category × date range × traveler profile × tool. |
| 44 | `research_gap_router` | Handle low-confidence or failed research (escalate / defer / ask traveler). |
| 45 | `agentic_research_planner` | Plan which tools to call for a complex intent. |
| 46 | `recommendation_explainer` | Explain the operational reason behind a recommendation. |

---

### A.8 B2 — Professional Networking / Founder Events (10 tools)

| # | Tool | Purpose |
|---|---|---|
| 47 | `luma_event_discovery` | Luma events by city, dates, topics. |
| 48 | `meetup_event_discovery` | Meetup events by topics + city. |
| 49 | `eventbrite_event_discovery` | Eventbrite events, especially free/local/community/professional. |
| 50 | `professional_networking_scanner` | Aggregate Luma + Meetup + Eventbrite + Search + coworking + accelerator + university + VC newsletter calendars. |
| 51 | `founder_event_finder` | Specialized: startup meetups, demo days, VC panels, AI/web3 gatherings, builder nights. |
| 52 | `coworking_event_calendar_scanner` | Coworking event calendars (WeWork, Impact Hub, Talent Garden, Factory Berlin, La Maquinita, Urban Station). |
| 53 | `accelerator_calendar_scanner` | Accelerator + startup-community calendars (Startup Grind, Techstars, YC, Antler, Plug and Play, 500, MassChallenge, Endeavor). |
| 54 | `university_entrepreneurship_event_scanner` | University entrepreneurship events (Stanford eCorner, Harvard iLab, MIT, Berkeley SkyDeck, Columbia, NYU, Cambridge Judge). |
| 55 | `vc_newsletter_event_scanner` | VC / newsletter / event ecosystems (a16z, First Round, Sequoia, NFX, LSVP, Index, General Catalyst, Lenny's, Every, The Information, TechCrunch, Sifted, EU-Startups). |
| 56 | `networking_intro_strategy` | Practical advice: should you attend, what crowd, arrival timing, intro strategy, who to talk to, worth-the-evening verdict. |

---

### A.9 B3 — Events, Culture, Nightlife (13 tools)

| # | Tool | Purpose |
|---|---|---|
| 57 | `concert_discovery` | Concerts + live music (Songkick + Ticketmaster + local). |
| 58 | `mainstream_event_discovery` | Concerts, theater, sports, comedy, family shows, festivals. |
| 59 | `cultural_attractions_finder` | Museums, galleries, monuments, cultural landmarks. |
| 60 | `museum_ticketing_researcher` | Tickets, hours, closed days, free-entry days, exhibitions. |
| 61 | `nightlife_fit_finder` | Bars, jazz clubs, rooftops, speakeasies, lounges, clubs. |
| 62 | `family_friendly_event_finder` | Family-friendly events + activities. |
| 63 | `exhibition_calendar_researcher` | Temporary exhibitions. |
| 64 | `festival_calendar_scanner` | Festival detection (city + region). |
| 65 | `free_events_finder` | Free events + activities. |
| 66 | `last_minute_tickets_finder` | Available events tonight/tomorrow. |
| 67 | `venue_nearby_plan_builder` | Given an event, build dinner-before + bar-after + route plan. |
| 68 | `crowd_level_predictor` | Estimate crowd pressure (PredictHQ). |
| 69 | `rainy_day_plan_finder` | Indoor plans when weather is bad. |

---

### A.10 B4 — Corporate / Business Travel (10 tools)

| # | Tool | Purpose |
|---|---|---|
| 70 | `client_dinner_recommender` | Restaurants for client dinners (private rooms, quiet, parking, dress code). |
| 71 | `executive_lounge_finder` | Hotel lounges, airport lounges, premium cafés. |
| 72 | `private_meeting_room_finder` | Hourly meeting rooms. |
| 73 | `business_dress_code_brief` | Clothing by city × weather × industry × meeting type. |
| 74 | `local_business_protocol_brief` | Practical business etiquette. |
| 75 | `expense_policy_checker` | Plan-vs-policy compliance. |
| 76 | `receipt_collection_assistant` | Track missing receipts, invoices, folios, documents. |
| 77 | `vat_refund_researcher` | VAT refund / tax-free rules. |
| 78 | `corporate_travel_risk_digest` | Daily Slack digest for travel teams. |
| 79 | `meeting_commute_planner` | Calculate when to leave for a meeting. |

---

### A.11 B5 — Sports / Fan Travel (7 tools)

| # | Tool | Purpose |
|---|---|---|
| 80 | `team_travel_package_builder` | Flight + hotel + ticket + transfer + food package around a match. |
| 81 | `stadium_day_plan` | Full match day plan. |
| 82 | `away_fan_safety_brief` | Cautious advice for away fans. |
| 83 | `ticket_resale_risk_checker` | Resale ticket risk evaluation. |
| 84 | `sports_bar_finder` | Bars to watch a match. |
| 85 | `match_postponement_monitor` | Fixture changes (composes existing match-fixtures tool). |
| 86 | `fan_group_coordination_tool` | Group fan travel coordination. |

---

### A.12 B6 — Lifestyle / Local Commerce (12 tools)

| # | Tool | Purpose |
|---|---|---|
| 87 | `shopping_district_brief` | Shopping areas by style + budget. |
| 88 | `local_designer_finder` | Local designers, boutiques, concept stores. |
| 89 | `market_day_finder` | Markets + fairs. |
| 90 | `gift_recommender` | Local gifts by budget + recipient. |
| 91 | `pharmacy_product_mapper` | Common products → local names. |
| 92 | `electronics_adapter_checker` | Plug type, voltage, where to buy adapters. |
| 93 | `luggage_repair_finder` | Luggage repair + urgent fixes. |
| 94 | `laundry_service_finder` | Laundry + pickup services. |
| 95 | `tailor_urgent_finder` | Urgent tailoring. |
| 96 | `personal_shopper_light` | Shopping routes by style. |
| 97 | `vintage_thrift_finder` | Vintage / thrift shops. |
| 98 | `craft_beer_finder` | Taprooms, breweries, beer events. |

---

### A.13 B7 — Health, Safety, Wellness (10 tools)

| # | Tool | Purpose |
|---|---|---|
| 99 | `clinic_finder` | Clinics, private hospitals, urgent care. |
| 100 | `pharmacy_24h_finder` | 24h pharmacies. |
| 101 | `travel_vaccine_researcher` | Required / recommended vaccines. |
| 102 | `food_safety_brief` | Water + food safety brief. |
| 103 | `allergy_safe_restaurant_finder` | Restaurants safe for allergies / dietary needs. |
| 104 | `emergency_numbers_card` | Local emergency numbers + consulate contacts. |
| 105 | `embassy_consulate_locator` | Embassy / consulate by nationality. |
| 106 | `safe_route_home` | Safer route / mode home at night. |
| 107 | `area_after_dark_check` | After-dark suitability of an area. |
| 108 | `scam_risk_brief` | Common scams by city. |

---

### A.14 B8 — Trip Intelligence / Anticipation (13 tools)

| # | Tool | Purpose |
|---|---|---|
| 109 | `city_pulse_brief` | Daily city brief: weather, events, protests, closures, traffic, holidays, opportunities, avoid zones. |
| 110 | `trip_opportunity_ranker` | Rank opportunities by traveler fit. |
| 111 | `itinerary_gap_detector` | Empty time windows. |
| 112 | `micro_itinerary_builder` | 2–4 hour mini itineraries. |
| 113 | `layover_city_escape` | Can the traveler leave the airport during layover? |
| 114 | `first_day_soft_plan` | Gentle arrival-day plan. |
| 115 | `last_day_checkout_plan` | Gap between hotel checkout and flight. |
| 116 | `luggage_storage_finder` | Lockers / storage. |
| 117 | `trip_pacing_optimizer` | Avoid overpacked itineraries. |
| 118 | `weather_replan_engine` | Replan activities based on weather. |
| 119 | `group_preference_reconciler` | Combine preferences across group travelers. |
| 120 | `perfect_evening_builder` | Evening from weather + restaurants + events + route + safety. |
| 121 | `trip_contextual_recommender` | Recommend from situation, not category. |

---

### A.15 B9 — Travel Disruption / Policy / Logistics Research (21 tools)

| # | Tool | Purpose |
|---|---|---|
| 122 | `airport_disruption_monitor` | Strikes, closures, delays, weather, construction. |
| 123 | `local_holiday_disruption_check` | Holidays, elections, school vacations, closures, protests. |
| 124 | `venue_policy_checker` | Bag policy, ID, entry time, prohibited items, accessibility, parking. |
| 125 | `hotel_area_intelligence` | Score hotel area: safety, walkability, corporate fit, nightlife, transit, nearby essentials. |
| 126 | `neighborhood_fit_matcher` | Match neighborhoods to traveler profile. |
| 127 | `restaurant_reservation_researcher` | Reservation, deposit, dress code, menu, booking URL. |
| 128 | `menu_dietary_researcher` | Menus for dietary restrictions. |
| 129 | `ground_transport_price_researcher` | Taxi / Uber / Cabify / bus / train estimates. |
| 130 | `public_transit_ticketing_brief` | How to pay for transit locally. |
| 131 | `airport_terminal_resolver` | Terminal, check-in area, lounge options. |
| 132 | `layover_viability_checker` | Connection risk, terminals, immigration, visa transit, baggage. |
| 133 | `nearby_airport_alternative_researcher` | Alternate airports. |
| 134 | `route_alternative_researcher` | Train / bus / ferry / nearby-airport alternatives. |
| 135 | `trip_budget_researcher` | Local daily spend estimate. |
| 136 | `local_payment_acceptance_brief` | Cash / card / local wallets / ATM norms. |
| 137 | `invoice_tax_requirements_researcher` | Corporate invoice / tax requirements. |
| 138 | `travel_insurance_requirement_checker` | Insurance requirements. |
| 139 | `medical_access_brief` | Clinics, pharmacies, emergency, private health. |
| 140 | `communications_researcher` | Connectivity, networks, coverage, roaming. |
| 141 | `cultural_protocol_brief` | Practical etiquette for local interaction. |
| 142 | `live_news_trip_risk_scanner` | Recent news for risks affecting a trip. |

---

### A.16 B10 — Agency Ops / Travel Team Automation (10 tools)

| # | Tool | Purpose |
|---|---|---|
| 143 | `supplier_quote_comparator` | Compare supplier quotes. |
| 144 | `manual_supplier_researcher` | Find local suppliers when no API exists. |
| 145 | `supplier_contact_extractor` | Extract email, phone, WhatsApp, form URL, hours. |
| 146 | `supplier_reliability_score` | Score suppliers from public signals + internal feedback. |
| 147 | `ops_followup_scheduler` | Schedule follow-ups. |
| 148 | `booking_gap_auditor` | Find missing info: passport, passenger, hotel check-in, transfer location, unpaid invoice, missing receipt. |
| 149 | `handoff_context_builder` | Complete context for human escalation. |
| 150 | `post_trip_feedback_analyzer` | Trip feedback → supplier score + traveler prefs. |
| 151 | `agency_margin_guard` | Margin + commercial policy checks before recommendations. |
| 152 | `preferred_supplier_router` | Prioritize agency-preferred suppliers. |

---

## 16. API / data source setup

| Service | Status | Env var(s) | Notes |
|---|---|---|---|
| **Google Cloud (Places API New, Routes, Geocoding, Address Validation, Maps Static, Custom Search JSON)** | ✅ wired | `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CUSTOM_SEARCH_ENGINE_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` (Vertex), `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` | Single locked-down GCP project. Places API New uses FieldMask. Per-tenant Vision budget cap mandatory. |
| **Eventbrite** | ✅ wired (4 creds × 3 envs) | `EVENTBRITE_PRIVATE_TOKEN` (canonical for server queries), `EVENTBRITE_API_KEY`, `EVENTBRITE_CLIENT_SECRET`, `EVENTBRITE_PUBLIC_TOKEN` | Free private token works for HP1 + B2 event discovery. |
| **Luma Public API** | ⏳ **pending — paid for production volume** | `LUMA_API_KEY` | Free tier exists for low-volume; founder/AI/web3 events are HP1's gold. Get from `help.luma.com/p/luma-api`. Header: `x-luma-api-key`. |
| **Meetup GraphQL** | ⏳ **pending — paid (Meetup Pro / Meetup Plus tier)** | `MEETUP_CLIENT_ID`, `MEETUP_CLIENT_SECRET`, `MEETUP_ACCESS_TOKEN` | OAuth flow once; advanced search features may require paid tier. Get from `meetup.com/api/oauth/list`. |
| **Ticketmaster Discovery API** | ⏳ pending key-fetch (free tier) | `TICKETMASTER_API_KEY` | B3 mainstream events. `developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/`. |
| **PredictHQ** | ⏳ **pending — paid only** | `PREDICTHQ_ACCESS_TOKEN` | B3 #68 crowd_level_predictor + B8 #109 city_pulse_brief. `docs.predicthq.com`. |
| Michelin / 50 Best / official guide sources | n/a — public web | — | Search-based extraction via Google Custom Search. |
| Coworking / accelerator / university / VC seed lists | n/a — public web scraping (low frequency) | — | Per-source allowlist in `packages/web-search/`. Seed lists in roadmap appendix. |

**Pending paid services (Luma, Meetup, PredictHQ, Ticketmaster) are gated behind Phase 2.** Phase 1 of "First 20 tools" (§17) ships entirely on already-wired Google + Eventbrite + Vertex stack. **Do not block Phase 1 on paid-API procurement.**

---

## 17. First 20 tools to build

The minimum viable set that ships the killer demo: *"Build my personal city pack for Tokyo."*

### Phase 1 — Magic personalization (10 tools)

1. `hobby_profile_builder`
2. `city_bucket_list_manager`
3. `specialty_coffee_finder`
4. `work_from_cafe_ranker`
5. `budget_estimator`
6. `visual_aesthetic_scorer`
7. `monocle_place_researcher`
8. `beauty_budget_ranker`
9. `city_taste_map_builder`
10. `hobby_concierge_discover`

### Phase 2 — Food + events (6 tools)

11. `cheap_michelin_finder`
12. `ramen_finder`
13. `foodie_shortlist_builder`
14. `luma_event_discovery` *(blocked on paid `LUMA_API_KEY`)*
15. `meetup_event_discovery` *(blocked on paid Meetup OAuth)*
16. `professional_networking_scanner`

### Phase 3 — Date planner (4 tools)

17. `date_budget_optimizer`
18. `date_perfume_advisor`
19. `date_game_tips`
20. `date_plan_builder`

### Highest-priority demo (the recording target)

```
> Build my personal city pack for Tokyo.
> I like specialty coffee where I can work, serious ramen under $20,
> affordable Michelin/Bib-style restaurants, beautiful date spots,
> and founder/AI events.
```

**Expected Sendero answer:**

```
I built your Tokyo Taste Map:

- 8 serious ramen shops under $20
- 11 specialty coffee spots good for work
- 5 affordable Michelin/Bib-style restaurants
- 4 beautiful date spots by budget
- 3 founder/AI events this week

First move tonight: ramen counter near your hotel.
Tomorrow morning: specialty coffee work block.
Thursday night: AI founder meetup.
```

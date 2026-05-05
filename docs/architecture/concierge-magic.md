# Concierge magic — backbone spec

> Status: **draft, in flight**. Owner: Tomas + agent runtime.
> Companion to: `BUILD_VERTICAL_AI_AGENT.md`, `docs/architecture/ancillaries-next-wave.md`.

The post-booking concierge funnel that turns Sendero from "I booked
your flight" into "I run your trip." LATAM's 8-step "Marca tus pasos"
is the inspiration; Sendero's version is voice-first, global, runs in
the background, and treats accommodation booked elsewhere as the same
first-class signal as accommodation booked through us.

This doc is the contract. Every implementation file points back to a
section here. If the implementation diverges from the spec, update the
spec or revert the code — never let them drift silently.

---

## §1 · Principles

1. **Show up first, with context.** The traveler does not pull. Sendero
   pushes — at exactly the right moment with exactly the right state.
2. **Voice is first-class input.** Kapso transcribes inbound audio
   before the turn fires; the agent treats text and voice identically.
3. **Silence is structural, not decorative.** Context loading runs
   pre-turn. The traveler never sees `Let me check your trip…`.
4. **Honor prior choices, never relitigate.** If they booked their
   Airbnb elsewhere, Sendero acts on it; it does not re-pitch hotels.
5. **API-first, global by construction.** No hand-curated seeds. The
   same code path serves Lima, Reykjavik, Hanoi.
6. **Magic moments are gifts.** The unrequested arrival-day note has
   no payment surface. Upsells live on the checklist where the
   traveler invited them.

---

## §2 · Data model

### §2.1 · `TravelerProfile` (new)

One row per Sendero `User`, tenant-scoped. Mutated by silent write
hooks; read once per turn during pre-fetch.

```prisma
model TravelerProfile {
  id              String    @id @default(cuid())
  userId          String    @unique
  tenantId        String

  // Accumulated preferences (low-confidence inference allowed)
  dietary         String[]                    // 'vegetarian', 'celiac', 'halal'
  allergies       String[]                    // 'shellfish', 'peanuts'
  pace            String?                     // 'plan_ahead' | 'mix' | 'improvise'
  voicePreferred  Boolean   @default(false)   // flips true after first inbound audio

  // Travel patterns
  preferredCabin  String?                     // 'economy' | 'premium_economy' | 'business' | 'first'
  redEyeOK        Boolean   @default(true)
  layoverMaxMin   Int?
  preferredLang   String?                     // BCP-47

  // Memory
  visitedCities   Json      @default("[]")    // [{ iso2, citySlug, lastVisitedAt }]
  totalTrips      Int       @default(0)
  lastTripAt      DateTime?

  // Loyalty
  loyaltyAccounts Json?                       // { airlines: { AA: '12345' }, hotels: {} }

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant          Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, lastTripAt])
}
```

**Why per-user, not per-trip:** cross-trip magic ("you preferred direct
last time", "you mentioned a shellfish allergy in March") is the
backbone. Per-trip metadata loses memory at trip-end.

### §2.2 · `Trip.metadata.ancillaryChecklist` (new field on existing Json)

Per-trip checklist state. Lives on `Trip.metadata` (Json), no schema
migration. Initialized at `book_flight` confirm; updated by checklist
taps and by ancillary tool successes.

```ts
interface AncillaryChecklist {
  items: {
    upgrade:    AncillaryItem;       // Duffel order_change cabin uplift
    baggage:    AncillaryItem;       // pre- or post-book bag
    seat:       AncillaryItem;
    lodging:    LodgingItem;         // see §2.3 — lodging is special
    insurance:  AncillaryItem;
    assistance: AncillaryItem;       // medical/travel assistance distinct from insurance in LATAM
    transfer:   AncillaryItem;
    esim:       AncillaryItem;
    car:        AncillaryItem;       // not integrated yet → 'unavailable'
  };
  openedAt:        string;           // ISO when book_flight fired init
  touchBackSentAt: string | null;    // ISO when T-48h fired (idempotent guard)
  concierge24SentAt: string | null;  // ISO when T-24h fired
  dismissedAt:     string | null;
}

type AncillaryStatus =
  | 'pending'
  | 'done'
  | 'skipped'
  | 'unavailable';                   // surface as locked tile

interface AncillaryItem {
  status: AncillaryStatus;
  completedAt?: string;              // ISO
  // Tool-specific refs (rate id, esim id, policy id…) for traceability
  ref?: string;
}
```

### §2.3 · Lodging item (the new shape)

Accommodation is **not a prerequisite for the funnel**. The checklist
opens the moment the flight is ticketed regardless of whether Sendero
booked the lodging or the traveler did it elsewhere.

```ts
type LodgingStatus =
  | 'sendero_booked'    // book_stay confirmed via Sendero
  | 'external_known'    // traveler shared name + we geocoded
  | 'external_unknown'  // traveler hasn't told us yet
  | 'pending'           // initial state immediately after book_flight
  | 'skipped';          // traveler explicitly declined to share

interface LodgingItem {
  status: LodgingStatus;
  // When sendero_booked
  bookingId?: string;
  // When external_known
  externalName?: string;             // "Airbnb Miraflores 4B"
  externalProvider?: 'airbnb' | 'booking' | 'hotel_direct' | 'other';
  // Always — when known
  coords?: { lat: number; lng: number };
  formattedAddress?: string;
  city?: string;
  country?: string;                  // ISO-2
  checkInDate?: string;              // YYYY-MM-DD
  checkOutDate?: string;
  // Geocoded source — for traceability
  geocodedAt?: string;
}
```

The concierge can act on `external_known` identically to
`sendero_booked` once Google Places resolves the name. **The funnel
treats both as "we know where you sleep" and tailors the rest of the
checklist around it.**

---

## §3 · Pre-fetch contract (silence policy)

### §3.1 · The graph node owns context

The Kapso graph node `prefetch_trip` runs **before** the agent turn
begins. It is the only place context loading happens. The agent never
calls `get_whatsapp_context` or `get_active_trip`.

```
graph: trigger → prefetch_trip → router → tenant_travel_agent / money_agent
                       │
                       └─ stamps vars (one bulk read, parallel queries):
                          from_phone
                          active_trip_status, _id, _iso2, _dates, …
                          traveler_profile_*       (NEW)
                          recurring_traveler_*     (NEW)
                          last_visit_to_destination (NEW)
```

### §3.2 · Vars contract

The agent prompt slab reads these directly. **Never** invokes a tool
to re-derive them.

```
{{vars.from_phone}}                      E.164
{{vars.active_trip_status}}              'ok' | 'no_active_trip' | 'no_traveler' | 'sendero_error'
{{vars.active_trip_id}}                  cuid
{{vars.active_trip_iso2}}                comma-joined ISO-2 list
{{vars.active_trip_dates}}               'YYYY-MM-DD..YYYY-MM-DD'
{{vars.active_trip_kind}}                'one_way' | 'round_trip' | 'open_journey'
{{vars.active_trip_pnr}}
{{vars.active_trip_origin}}              IATA
{{vars.active_trip_destination}}         IATA
{{vars.active_trip_current_location}}    IATA (open-journey)
{{vars.active_trip_home_iata}}           IATA

{{vars.traveler_profile_total_trips}}    integer
{{vars.traveler_profile_last_trip_at}}   ISO
{{vars.traveler_profile_visited_cities}} comma-joined "iso2:slug" list
{{vars.traveler_profile_dietary}}        comma-joined
{{vars.traveler_profile_allergies}}      comma-joined
{{vars.traveler_profile_pace}}           string
{{vars.traveler_profile_voice_preferred}} 'true' | 'false'
{{vars.traveler_profile_preferred_cabin}} string
{{vars.traveler_profile_preferred_lang}} BCP-47

{{vars.recurring_traveler_display_name}}
{{vars.recurring_traveler_has_saved_passport}}
{{vars.recurring_traveler_prior_trip_count}}
{{vars.recurring_traveler_returning_to_destination}} 'true' | 'false'
```

### §3.3 · Prompt slab change (mandatory)

The current `## FIRST ACTION OF EVERY EXECUTION` block in
`workflow.js` and `definition.json` must be replaced by:

```
## EVERY TURN STARTS WITH CONTEXT PRE-LOADED

`prefetch_trip` ran silently before this turn. Read directly from vars:

  {{vars.from_phone}} — pass as `travelerPhone` on every call_sendero
  {{vars.active_trip_*}} — full active-trip context
  {{vars.traveler_profile_*}} — preferences + memory
  {{vars.recurring_traveler_*}} — name, prior trips, returning to destination

DO NOT call get_whatsapp_context. DO NOT call get_active_trip. They
already ran. The first tool of every turn is the user-facing one
(send_*, search_*, book_*, scan_*, complete_*).

Skip even the void preamble for pure small-talk ("hola", "thanks") —
go straight to send_* + complete_task.
```

### §3.4 · `silent: true` on `ChannelMessageToolInvocation`

`apps/app/lib/channel-render/types.ts`:

```ts
export interface ChannelMessageToolInvocation {
  kind: 'tool_invocation';
  // …existing fields…
  /**
   * When true, the operator preview collapses this into a one-line
   * debug-drawer entry instead of a `<Tool>` block. Traveler-facing
   * channels (Slack/WhatsApp/web/email) already drop tool_invocation
   * by design; this flag governs the OPERATOR surface only.
   *
   * Set by the agent runtime when the tool result carries
   * `_meta: { silent: true }`, OR by tools tagged `silent: true` in
   * their ToolDef.
   */
  silent?: boolean;
}
```

`operator.tsx` switch case:

```tsx
case 'tool_invocation': {
  if (msg.silent) {
    return <SilentDebugLine name={msg.toolName} status={msg.status} />;
  }
  return <Tool>…full block…</Tool>;
}
```

`SilentDebugLine` is a 12px monospace line in the operator chat —
visible but unobtrusive. Nothing else changes for non-operator
channels because they already drop tool_invocation.

---

## §4 · Profile write hooks

All hooks fire **fire-and-forget** (`void promise.then().catch(log)`).
Failures never block the user-facing reply.

| Trigger | Update |
|---|---|
| `book_flight` returns `ticketed` | `totalTrips++`, append destination to `visitedCities`, set `preferredCabin` if user picked non-default, set `lastTripAt = now()` |
| `book_stay` returns confirmed | append destination city to `visitedCities` if not already present |
| `book_esim` returns ok | (no profile write — already on EsimProfile) |
| WhatsApp inbound `audio` | set `voicePreferred = true` (one-way; never flips back without explicit user toggle) |
| Loyalty programme account given to Duffel | upsert into `loyaltyAccounts` |
| Restaurant tap with cuisine filter `vegetarian` | infer `dietary += ['vegetarian']` (low confidence; bias-correct over time) |

**Idempotency:** all writes use Prisma `upsert` keyed on `userId`. The
profile row is created on first hook fire (lazy — no provisioning step
at User creation).

**Locale:** `preferredLang` is set from the Kapso turn's locale on
first run, then sticky.

---

## §5 · `local_color_brief` tool

### §5.1 · Contract

```ts
interface LocalColorBriefInput {
  destinationIso2: string;           // ISO-3166-1 alpha-2
  /** Used for "this week" trending signals + weather window. */
  dateRange: { from: string; to: string };  // ISO dates
  /** Tailors restaurant + neighborhood signals when known. */
  lodgingCoords?: { lat: number; lng: number };
  /** BCP-47. Defaults from TravelerProfile.preferredLang. */
  lang?: string;
}

interface LocalColorBriefResult {
  bullets: string[];                 // 3-5 lines
  composedFrom: string[];            // ['weather', 'timezone', 'tipping', 'places_trending']
  city: string | null;               // resolved from coords or country capital fallback
  iso2: string;
  /** When at least one signal failed; bullets degrade gracefully. */
  partial: boolean;
}
```

### §5.2 · Composition order (parallel)

```ts
const [weather, timezone, tipping, country, restaurants, trending] =
  await Promise.all([
    tripWeatherBrief({ ... }),
    timezoneBrief({ ... }),
    tippingEtiquette({ countryIso2: input.destinationIso2 }),
    Promise.resolve(getCountryByIso2(input.destinationIso2)),
    input.lodgingCoords
      ? recommendRestaurants({ coords: input.lodgingCoords, lang })
      : null,
    placesTrendingNear({ coords: cityCoords, lang }),  // NEW thin wrapper
  ]);
```

**No sequential calls.** Tail latency = max(slowest single call), not
sum.

### §5.3 · `placesTrendingNear` (new thin wrapper)

Wraps Google Places **Text Search (New)** filtered by category +
ordered by `RATING_RECENT` or `RELEVANCE`. Composes with `popularTimes`
on the resulting place IDs to surface "currently popular" venues.
Cached per `(lat,lng,categoryHash,dayOfWeek)` for 6h.

```ts
interface PlacesTrendingInput {
  coords: { lat: number; lng: number };
  /** Default radius 3km — concentric to lodging or city center. */
  radiusMeters?: number;
  /** Default categories: restaurant, bar, tourist_attraction, museum. */
  categories?: string[];
  lang?: string;
}

interface PlacesTrendingResult {
  trending: Array<{
    placeId: string;
    name: string;
    category: string;
    rating: number;
    /** Ratio: current_popularity / typical_for_this_dow_hour */
    popularityRatio: number;
    distanceMeters: number;
  }>;
}
```

The "this week peaking" signal comes from
`popularityRatio > 1.5` filtered after the initial sort.

**No seeded data anywhere in this path.** Tanzania, Iceland, Vietnam
return the same shape; the bullet output is just thinner where Places
data is sparser.

### §5.4 · Bullet composition

Each bullet is generated from one signal. The composer picks the top
3-5 by signal strength:

```
weather_strong    → "🌧 Llovizna ligera lun-mar — saco liviano alcanza"
sunset_window     → "🌅 Sunset 17:42 hoy"
trending_venue    → "🥘 La Mar trending esta semana — picos jue-sáb"
tipping_quirk     → "💵 USD aceptado en zonas turísticas; 10% propina"
restaurant_near   → "🍽 3 parrillas a 4 min de tu Airbnb"
greeting_culture  → "👋 'Hola' alcanza — el voseo es opcional"
```

Localized via `lang`. Spanish strings live in
`packages/tools/src/local-color-brief.copy.ts` keyed by `(signal, lang)`.

### §5.5 · Failure modes

- **Weather API down** → bullets[] just omits weather; `partial: true`.
- **Places API down** → drops trending + restaurants; falls back to
  weather + timezone + tipping.
- **`lodgingCoords` undefined** → trending centers on city coords from
  `@sendero/location/countries.json` (capital-city default), restaurant
  bullet skipped.
- **`destinationIso2` unknown** → throws `LocationNotResolvedError`.
  Caller (touch-back workflow) catches and skips the preamble; the
  checklist still fires without color.

---

## §6 · Touch-back workflow

### §6.1 · Schedule

A WDK workflow `sendero.concierge_touchback` runs on a 15-min cron via
`@sendero/workflows`. It queries:

```ts
const candidates = await prisma.trip.findMany({
  where: {
    status: { in: ['booked', 'in_progress'] },
    firstSegmentDepartureAt: { gt: now() },
    metadata: {
      path: ['ancillaryChecklist', 'touchBackSentAt'],
      equals: null,
    },
  },
  // … then filter in code: firstSegmentDepartureAt - now() <= 48h
});
```

### §6.2 · Touch-1 (T-48h) — ancillary checklist + local color

Composes:
1. `local_color_brief` (preamble — 3-5 bullets)
2. `trip_ancillary_checklist` ChannelMessage (the 0/7 list)
3. If `lodging.status === 'pending' || 'external_unknown'`: append the
   accommodation-info-ask card

Channel cascade:
- WhatsApp first if `from_phone` set
- Email fallback after 6h with no inbound (next cron tick)
- Slack — for tenant-side dashboard ping only, not customer-facing

Stamps `touchBackSentAt = now()` after dispatch.

### §6.3 · Touch-2 (T-24h) — concierge intake

Single message:
```
👋 Mañana volás a {{city}}.

¿Cómo lo querés organizar? Contame por audio o texto:
• A qué hora llegás y cómo querés moverte
• Si vas por trabajo, placer, o ambos
• Si te gusta planear todo o ir improvisando
• Algo que ya tengas reservado o no quieras perderte

🎤 Tip: mandá un audio. Es 5x más rápido que tipear.
```

Locale-aware (es-AR, es-MX, pt-BR, en-US). On reply, the agent fans
out into existing concierge tools (`airport_arrival_playbook`,
`recommend_restaurants`, `trip_weather_brief`,
`airport_transfer_coordinator`). Stamps `concierge24SentAt = now()`.

### §6.4 · Silence policy for the workflow

The workflow itself NEVER posts a "I'm checking your trip" message
before the actual content. It ONLY emits when there's something to
say. Silence is not a sin; verbosity is.

---

## §7 · Test coverage (the contract is the test)

### §7.1 · Unit (per package)

| File | Covers |
|---|---|
| `packages/database/__tests__/traveler-profile.test.ts` | upsert idempotency, tenant scoping, JSON column shape |
| `packages/tools/src/local-color-brief.test.ts` | parallel composition, partial-failure degradation, lang fallback |
| `packages/tools/src/places-trending.test.ts` | popularity ratio threshold, category filter, cache key |
| `packages/tools/src/profile-hooks.test.ts` | book_flight write, book_stay write, voice receipt write |
| `apps/app/lib/channel-render/__tests__/silent-tool.test.ts` | silent flag drops Tool block, surfaces SilentDebugLine |

### §7.2 · Integration

| File | Covers |
|---|---|
| `apps/app/__tests__/concierge-touchback.e2e.test.ts` | WDK cron picks up trip at T-48h, fires touch-1, stamps sentAt, idempotent on re-run |
| `apps/kapso-functions/sendero-prefetch-trip/__tests__/prefetch.test.ts` | bulk read populates all vars, profile lookup tenant-scoped |

### §7.3 · End-to-end

Manual dogfood checklist (in `BUILD_VERTICAL_AI_AGENT.md`):
- [ ] Book flight via WhatsApp → checklist init confirmed in Trip.metadata
- [ ] Wait until T-48h → touch-1 lands with local-color preamble
- [ ] Tap eSIM row → existing book_esim flow runs, status flips done
- [ ] Send voice note "me quedo en Airbnb Miraflores" → lodging
      status flips external_known, geocode persists
- [ ] T-24h concierge intake lands; reply with voice → playbook fires
- [ ] T+0 arrival; complete_trip mints NFT; checklist locks

---

## §8 · Build order

```
0. Spec (this doc)              ← committed first
1. TravelerProfile migration    (#110) ~15 min
2. prefetch_trip beefup         (#111) ~30 min
3. Prompt slab silence update   (#112) ~20 min Kapso push
4. silent: true flag            (#113) ~30 min
5. Profile write hooks          (#114) ~45 min
6. local_color_brief tool       (#115) ~45 min
7. Touch-1 wiring               (#116) ~30 min
```

Steps 1, 4, 5, 6 are local-only, no live deploy. Steps 2, 3, 7 cross
deploy boundaries — schedule outside dogfood windows.

---

## §9 · Open scoping calls

| Question | Default | Locked? |
|---|---|---|
| Whisper vs GST | KILLED — Kapso transcribes | ✅ |
| Profile persistence | Per-user table | ✅ |
| Local-color seeds | None — API-first only | ✅ |
| NFT mint timing | At `complete_trip`, not 7/7 | ✅ |
| Touch-1 channel cascade | WhatsApp first, email after 6h silence | proposed |
| `touchBackSentAt` re-fire on re-deploy | Idempotent — never re-fires for same trip | proposed |
| Workflow runtime | WDK (same as stamps/reputation/lifecycle) | proposed |

---

## §10 · Magic guardrails (in the prompt)

These belong in the prompt slab as hard rules:

```
## SILENCE POLICY (read first)

1. Never say "Let me check..." / "Looking up..." / "Procesando...".
   First token is a tool call OR the actual answer.
2. Never restate trip context the traveler just gave you.
3. Never re-ask for facts already in {{vars.traveler_profile_*}}.
4. Constant pings = anti-magic. After a send_*, your turn is OVER.
5. The unrequested arrival-day note is a gift — never attach an upsell.
6. If the traveler voice-notes, your reply tone matches: warm,
   concise, conversational. Never "I have noted your accommodation."
```

---

## §11 · Status checkpoints

Update this section as steps land:

- [x] §0 · Spec written
- [x] §2.1 · TravelerProfile migration (live in dev DB)
- [x] §3 · prefetch_trip beefup + prompt slab update (Kapso lock_version 138)
- [x] §3.4 · silent flag (operator preview collapses context tools)
- [x] §4 · Profile write hooks (book_flight + book_stay + audio)
- [x] §5 · local_color_brief tool (API-first, no seeds)
- [x] §6 · Touch-back workflow (concierge-touchback WDK; Touch-1 only — Touch-2 deferred)

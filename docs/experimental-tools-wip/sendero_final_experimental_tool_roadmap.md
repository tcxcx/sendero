# Sendero Experimental Concierge — Final Tool Roadmap

Version: v0.3  
Status: Draft for implementation  
Lifecycle: `experimental` by default  
Core thesis: **post-app, intent-driven, anticipatory**  
Core product belief: Sendero should not recommend generic “best places.” It should recommend the best places for the traveler’s taste, budget, context, timing, city, weather, route, and moment.

---

## Core idea

A directory says:

> “Here are restaurants near you.”

A travel app says:

> “Here are top-rated restaurants.”

Sendero should say:

> “For your taste, your budget, tonight’s weather, your hotel, and the energy you want, this is the move.”

The experimental concierge roadmap should prioritize tools that produce **judgment**:

- taste
- beauty
- budget
- routing
- vibe
- confidence
- context
- timing
- source quality
- traveler memory

---

## Existing stable base

Sendero already has a strong stable base:

- flights
- hotels
- eSIM
- wallet
- FX
- restaurants
- route maps
- transfers
- airport arrival
- weather
- air quality
- elevation
- timezone
- travel safety
- visas
- document scanning
- group trips
- TripPassport / NFT
- match fixtures
- tipping
- local color
- delay replanner
- check-in reminders
- trip brief
- traveler preference persistence

The tools below do not replace that base. They are a higher-level experimental layer for personalization, discovery, taste, budget-awareness, and anticipation.

---

# Highest-priority buckets

Some buckets are so load-bearing that they should ship before the rest of the standard sequence. Mark these with an **HP-prefix** (`HP1`, `HP2`, …) and keep them above the numbered `B1–BN` buckets in the scorecard.

## When to use HP-prefix

Use HP-prefix when:

- The bucket produces the strongest demo / “magic” moment for the product.
- It composes from already-shipped primitives, meaning high score / low new construction.
- It unlocks a category of follow-on work that other buckets depend on.
- It carries the lowest external-API or consent risk in the whole scorecard.

If two or more buckets meet these, sequence them `HP1`, `HP2`, `HP3` in priority order.

The standard `B1–BN` buckets stay numbered by score, not priority.

## Phasing rule

Phasing becomes:

- **Phase 1** = HP1 + foundation, such as feature flag / lifecycle metadata, + one cross-cutting B-bucket.
- **Phase 2** = HP1 feature-complete + HP2 starts.
- **Phase 3** = remaining B-buckets in score order.

This keeps the scorecard honest: everything is scored, nothing is hidden, but rollout sequence reflects product judgment rather than pure arithmetic.

---

# Tool lifecycle model

All tools in this document are experimental unless explicitly promoted.

```ts
type ToolLifecycle = "stable" | "experimental" | "deprecated";

type ExperimentalMetadata = {
  anticipatory: boolean;
  hpBucket?: "HP1" | "HP2" | "HP3" | "HP4";
  bucket: string;
  minConfidence?: "low" | "medium" | "high";
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

## Default experimental behavior

- `travelerVisibleByDefault = false`
- tool writes Phoenix span attributes
- tool writes source audit trail when using web/search/visual data
- tool produces confidence score
- tool can be used by stable tools as middleware
- tool is not automatically exposed to public MCP/API callers
- tool may power traveler-facing cards only after passing policy checks

## Phoenix span attributes

```txt
sendero.tool.lifecycle = experimental
sendero.experimental.bucket = HP1 | HP2 | B1 | ...
sendero.experimental.anticipatory = true | false
sendero.research.confidence = low | medium | high
sendero.research.source_count = number
sendero.research.official_source_count = number
sendero.research.visual_signal_count = number
sendero.research.budget_estimate_present = true | false
sendero.research.audit_id = string
```

---

# HP1 — Hobby-Aware Concierge / Traveler Taste Graph

## Why HP1

This is the strongest “magic” moment.

Flights, hotels, transfers, wallet, visas and eSIMs solve logistics. But the Hobby-Aware Concierge makes Sendero feel personally intelligent.

The wedge:

> “Every city I visit, Sendero automatically builds my personal map: specialty coffee shops where I can work, affordable Michelin/Bib-style restaurants, serious ramen, founder events, date spots, bookstores, wine bars, and beautiful local places that match my taste.”

This is not a generic “things to do” feature. It is a persistent traveler taste layer.

## Product primitive: Traveler Taste Graph

```ts
type TravelerTasteGraph = {
  travelerId: string;
  hobbies: Array<{
    key:
      | "specialty_coffee"
      | "work_from_cafes"
      | "cheap_michelin"
      | "bib_gourmand"
      | "worlds_50_best"
      | "ramen"
      | "founder_networking"
      | "ai_events"
      | "web3_events"
      | "meetups"
      | "date_spots"
      | "bookstores"
      | "wine_bars"
      | "record_stores"
      | "running"
      | "gyms"
      | "language_exchange"
      | "art_galleries"
      | "local_design"
      | string;
    priority: "low" | "medium" | "high";
    notes?: string;
    avoid?: string[];
    preferredTimeOfDay?: "morning" | "afternoon" | "evening" | "late_night";
    preferredBudget?: "budget" | "medium" | "premium" | "splurge" | "no_limit";
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

## HP1 tools

### 1. `hobby_profile_builder`

Builds and updates the traveler taste graph.

**Input**

```ts
type HobbyProfileBuilderInput = {
  travelerId: string;
  tripId?: string;
  explicitPreferences?: string[];
  inferredSignals?: Array<{
    source: "chat" | "saved_place" | "visited" | "feedback" | "booking" | "manual";
    value: string;
    confidence: "low" | "medium" | "high";
  }>;
};
```

**Output**

```ts
type HobbyProfileBuilderResult = {
  status: "ok" | "needs_confirmation";
  tasteGraph: TravelerTasteGraph;
  newPreferences: string[];
  updatedPreferences: string[];
  confidence: "low" | "medium" | "high";
};
```

**Implementation notes**

- Build on existing preference persistence.
- Do not infer sensitive personal attributes.
- Store travel-relevant preferences only.
- Let traveler correct the graph easily:
  - “Too fancy.”
  - “Less touristy.”
  - “More quiet.”
  - “Actually I do not like loud cafés.”

---

### 2. `city_bucket_list_manager`

Stores traveler feedback on places and events.

**Actions**

- save
- visited
- loved
- skip
- revisit
- recommend to friend

**Input**

```ts
type CityBucketListManagerInput = {
  travelerId: string;
  city: string;
  item: {
    name: string;
    category: string;
    placeId?: string;
    url?: string;
  };
  action:
    | "save"
    | "visited"
    | "loved"
    | "skip"
    | "revisit"
    | "recommend_to_friend";
};
```

**Output**

```ts
type CityBucketListManagerResult = {
  status: "ok";
  listId: string;
  itemStatus: "want_to_visit" | "visited" | "loved" | "skip" | "revisit";
};
```

**Why it matters**

This is the feedback loop. Every save/love/skip improves future rankings.

---

### 3. `hobby_concierge_discover`

High-level orchestration tool for hobbies.

**Input**

```ts
type HobbyConciergeDiscoverInput = {
  city: string;
  travelerId: string;
  tripId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  hobbies?: string[];
  mode:
    | "arrival_pack"
    | "today"
    | "tomorrow"
    | "work_from_cafe"
    | "foodie"
    | "networking"
    | "map"
    | "build_city_list";
};
```

**Output**

```ts
type HobbyConciergeDiscoverResult = {
  summary: string;
  sections: Array<{
    title: string;
    items: Array<{
      name: string;
      reason: string;
      expectedSpend?: string;
      action?: {
        label: string;
        actionId: string;
      };
    }>;
  }>;
  mapLayerId?: string;
  recommendedNextAction?: string;
};
```

**Example**

> “I built your Tokyo pack: 8 serious ramen shops under $20, 11 specialty coffee spots good for work, 5 affordable Michelin/Bib-style restaurants, 4 beautiful date spots, and 3 founder/AI events this week.”

---

### 4. `city_hobby_pack_builder`

Builds a complete city pack from traveler hobbies.

**Composes**

- `hobby_profile_builder`
- `specialty_coffee_finder`
- `work_from_cafe_ranker`
- `cheap_michelin_finder`
- `foodie_shortlist_builder`
- `ramen_finder`
- `luma_event_discovery`
- `meetup_event_discovery`
- `professional_networking_scanner`
- `hobby_map_layer_builder`
- `city_bucket_list_manager`

**Output**

```ts
type CityHobbyPackBuilderResult = {
  city: string;
  travelerId: string;
  packName: string;
  sections: Array<{
    key: string;
    title: string;
    items: Array<{
      name: string;
      category: string;
      reason: string;
      expectedSpend?: string;
      placeId?: string;
      url?: string;
      startsAt?: string;
      fitScore: number;
    }>;
  }>;
  topRecommendation?: {
    title: string;
    why: string;
    nextAction: string;
  };
  mapLayerId?: string;
};
```

---

### 5. `hobby_map_layer_builder`

Creates map layers by hobby.

**Layers**

- specialty coffee
- work cafés
- ramen
- cheap Michelin
- Bib Gourmand
- World’s 50 Best
- founder events
- date spots
- bookstores
- wine bars
- record stores
- local design
- nightlife
- local gems

---

### 6. `specialty_coffee_finder`

Finds specialty coffee shops and roasters.

**Signals**

- roaster / single-origin / espresso quality
- coffee-focused reviews
- Google Places rating
- local coffee guides
- photos
- opening hours
- distance
- traveler taste

**APIs**

- Google Places API New
- Google Routes API
- Google Search / Custom Search
- optional: Sprudge, European Coffee Trip, local coffee blogs

---

### 7. `work_from_cafe_ranker`

Ranks cafés specifically for working.

**Scores**

- WiFi
- power outlets
- quietness
- table comfort
- call suitability
- long-stay friendliness
- food availability
- good espresso
- route distance

---

### 8. `cheap_michelin_finder`

Finds affordable Michelin/Bib/guide-level restaurants.

**Searches**

- Bib Gourmand
- Michelin selected
- affordable lunch menu
- à la carte strategy
- high-signal restaurant under budget
- reservation availability
- expected spend

**APIs / sources**

- Michelin Guide official site
- Google Places
- Google Search
- TheFork / OpenTable / Resy where available
- official restaurant sites

---

### 9. `bib_gourmand_city_scanner`

Scans city for good-value guide restaurants.

---

### 10. `worlds50best_nearby_researcher`

Checks if a city has World’s 50 Best / regional 50 Best restaurants, bars, or hotels.

---

### 11. `foodie_shortlist_builder`

Combines:

- Michelin
- Bib Gourmand
- 50 Best
- Google Places
- local guides
- menus
- traveler taste
- budget estimator
- visual aesthetic scorer

---

### 12. `ramen_finder`

Specialized ramen discovery.

**Signals**

- ramen style
- price
- local reputation
- queue/wait
- counter vibe
- visual bowl quality
- guide/blog signals
- distance
- opening hours
- beauty-per-dollar

---

### 13. `bookstore_finder`

Finds independent bookstores, cafés-librerías, rare book stores, beautiful bookshops.

---

### 14. `wine_bar_finder`

Finds wine bars by taste, budget, date suitability, beauty, and route.

---

### 15. `record_store_finder`

Finds vinyl/music shops and local music culture spots.

---

### 16. `local_food_market_finder`

Finds food markets, street food markets, gastronomic halls, farmers markets.

---

### 17. `language_exchange_finder`

Finds language exchanges and low-pressure social events.

---

### 18. `running_route_finder`

Finds safe, scenic running routes near hotel/current location.

---

### 19. `gym_day_pass_finder`

Finds gyms with day passes near hotel/current location.

---

### 20. `yoga_pilates_class_finder`

Finds drop-in yoga, pilates and wellness classes.

---

### 21. `art_gallery_opening_finder`

Finds gallery openings, museum nights, art fairs and vernissages.

---

### 22. `hiking_day_trip_finder`

Finds day hikes and nature escapes near a city.

---

### 23. `photography_spot_finder`

Finds golden hour spots, viewpoints, street photography areas and beautiful corners.

---

# HP2 — Monocle-Level Taste Engine

## Why HP2

The Hobby-Aware Concierge discovers candidates.

The Taste Engine decides whether they are actually good.

This is the judgment layer.

It answers:

> “Is this place beautiful, tasteful, worth the money, right for this traveler, and logistically sane?”

## Internal scoring model

```ts
recommendationScore =
  qualitySignal
  + aestheticSignal
  + budgetFit
  + travelerTasteFit
  + logisticsFit
  - riskPenalty;
```

## HP2 tools

### 24. `visual_aesthetic_scorer`

Scores whether a place looks beautiful/tasteful from accessible images.

**Inputs**

```ts
type VisualAestheticScorerInput = {
  placeId?: string;
  imageUrls?: string[];
  officialWebsiteUrl?: string;
  instagramUrl?: string;
  category: "restaurant" | "cafe" | "bar" | "hotel" | "museum" | "date_spot" | "shop";
  travelerTaste?: {
    likes: string[];
    dislikes: string[];
  };
};
```

**Output**

```ts
type VisualAestheticScorerResult = {
  aestheticScore: number;
  visualTags: string[];
  warnings: string[];
  confidence: "low" | "medium" | "high";
};
```

**Aesthetic tags**

```ts
type AestheticTag =
  | "warm_lighting"
  | "natural_light"
  | "minimal"
  | "old_world"
  | "japanese_clean"
  | "editorial"
  | "romantic"
  | "cozy"
  | "design_forward"
  | "beautiful_counter"
  | "good_plating"
  | "lush_greenery"
  | "rooftop_view"
  | "generic"
  | "touristy"
  | "fluorescent"
  | "crowded"
  | "soulless"
  | "instagram_trap";
```

**Instagram note**

Do not rely on unauthorized Instagram scraping.

Use:

- Google Places photos
- official websites
- public image URLs
- user-provided URLs
- approved third-party providers if needed

---

### 25. `budget_estimator`

Estimates likely spend before recommending a place.

**Output**

```ts
type BudgetEstimatorResult = {
  expectedSpendPerPerson: {
    low: number;
    typical: number;
    high: number;
    currency: string;
  };
  budgetTier: "budget" | "medium" | "premium" | "splurge";
  assumptions: string[];
  moneyTalk: string;
};
```

**Budget signals**

```ts
type BudgetSignals = {
  googlePriceLevel?: number;
  menuPricesFromWebsite?: string[];
  michelinPriceSymbols?: string;
  reservationPlatformPrice?: string;
  reviewMentions?: string[];
  photoMenuOCR?: string[];
  cityCostIndex?: number;
  categoryDefaults?: Record<string, unknown>;
  previousTravelerSpend?: number;
};
```

**Principle**

Always output ranges, never fake exact numbers.

Examples:

- “Coffee + pastry: ~$7–12.”
- “Dinner à la carte: ~$35–50/person.”
- “Medium date across two spots: ~$45–70/person.”
- “Ramen: ~$9–18 unless premium.”

---

### 26. `monocle_place_researcher`

Deep-researches a single place.

**Checks**

- official website
- Google Places
- photos
- menu
- reservation
- Michelin / 50 Best / local guide mentions
- accessible social links
- recent reviews
- opening hours
- price
- vibe
- whether it is overrated

---

### 27. `beauty_budget_ranker`

Ranks candidates by **beauty-per-dollar**.

**Question**

> Which place feels the most beautiful, tasteful and memorable for the money?

---

### 28. `city_taste_map_builder`

Builds the complete taste map for a city.

---

### 29. `taste_feedback_loop`

Learns from traveler reactions.

**Signals**

- saved
- skipped
- loved
- visited
- recommended to friend
- too expensive
- too touristy
- beautiful but not worth it
- exact vibe
- bad lighting
- too loud
- too formal
- too generic

---

# HP3 — Romantic Concierge / Date Planner

## Why HP3

Sendero should be the best date planner in every city.

A good date is rarely one place.

It is a sequence:

1. low-pressure opener
2. main anchor
3. optional second move
4. graceful exit / safe route home

The date planner must be:

- budget-aware
- vibe-aware
- weather-aware
- route-aware
- safety-aware
- visually tasteful
- confidence-building

## Budget tiers

```ts
type DateBudgetTier =
  | "budget"
  | "medium"
  | "premium"
  | "splurge";
```

### Budget

Coffee + gallery + walk. Casual food + free event. Under local equivalent of ~$25–40/person.

### Medium

Good restaurant + cocktail/wine bar. Paid event + casual dinner. ~$40–90/person.

### Premium

Excellent restaurant + proper cocktail bar. Michelin-adjacent dinner + jazz/theater/rooftop. ~$90–180/person.

### Splurge

Tasting menu, luxury bar, private experience, premium tickets. Only if explicitly requested.

## HP3 tools

### 30. `date_profile_builder`

Captures dating preferences and constraints.

**Do not infer sensitive romantic/sexual traits.**

Store:

- budget
- vibe
- avoid
- preferred date length
- preferred first move
- quiet/loud preference
- casual/fancy preference

---

### 31. `date_budget_optimizer`

Translates a desired vibe into options by budget tier.

---

### 32. `date_game_tips`

Gives tasteful, respectful, confidence-building date advice.

**Allowed**

- confidence
- conversation
- timing
- optional second moves
- graceful exits
- consent-aware advice

**Not allowed**

- manipulation
- pickup artist tactics
- sexual pressure
- gender stereotypes
- creepy personalization

---

### 33. `date_perfume_advisor`

Gives fragrance advice.

Product principle:

> confidence + perfume

**Day profiles**

- citrus
- tea
- light woods
- neroli
- subtle musk
- green/fresh notes

**Night profiles**

- warm woods
- amber
- soft vanilla
- light tobacco
- elegant musk
- spicy citrus

**Rule**

The goal is discovery, not announcement.

---

### 34. `date_plan_builder`

Builds a multi-stop date plan.

**Timeline roles**

```ts
type DateTimelineRole =
  | "opener"
  | "anchor"
  | "second_move"
  | "exit";
```

---

### 35. `date_plan_ranker`

Generates multiple candidate date plans and ranks them.

**Ranking**

- vibe fit
- budget fit
- distance between spots
- weather resilience
- ease of conversation
- second move quality
- not too formal unless requested
- not too loud unless requested
- graceful exit

---

### 36. `date_second_move_finder`

Finds the perfect optional second move near the anchor.

**Options**

- dessert
- wine bar
- cocktail
- walk
- viewpoint
- music
- bookstore
- late coffee

---

### 37. `date_weather_replan`

Adjusts date plan based on rain, heat, cold, wind.

---

### 38. `date_route_safety_check`

Checks route smoothness and safety between date spots.

---

### 39. `romantic_city_pack_builder`

Builds date plans by budget tier.

---

# B1 — Research Infrastructure

## Why B1

Every experimental tool depends on source quality and auditability.

## Tools

### 40. `official_source_resolver`

Finds authoritative sources:

- official venue page
- airport page
- government page
- museum site
- restaurant website
- ticketing page
- airline page
- embassy page

### 41. `source_confidence_scorer`

Scores each source by:

- authority
- freshness
- locality
- specificity
- contradiction risk
- category fit

### 42. `research_audit_trail`

Stores why Sendero recommended something.

### 43. `source_cache_manager`

Caches research by:

- city
- category
- date range
- traveler profile
- tool name

### 44. `research_gap_router`

Handles low-confidence or failed research.

### 45. `agentic_research_planner`

Plans which tools to call for a complex intent.

### 46. `recommendation_explainer`

Explains the operational reason behind a recommendation.

---

# B2 — Professional Networking / Founder Events

## Tools

### 47. `luma_event_discovery`

Finds Luma events by city, dates and topics.

### 48. `meetup_event_discovery`

Finds Meetup events by topics and city.

### 49. `eventbrite_event_discovery`

Finds Eventbrite events, especially free/local/community/professional events.

### 50. `professional_networking_scanner`

Aggregates:

- Luma
- Meetup
- Eventbrite
- Google Search
- coworking calendars
- accelerator calendars
- university entrepreneurship centers
- VC newsletters

### 51. `founder_event_finder`

Specialized scanner for:

- startup meetups
- demo days
- VC panels
- AI/web3 gatherings
- builder nights

### 52. `coworking_event_calendar_scanner`

Scans coworking event calendars.

### 53. `accelerator_calendar_scanner`

Scans accelerator and startup community calendars.

### 54. `university_entrepreneurship_event_scanner`

Scans university entrepreneurship event calendars.

### 55. `vc_newsletter_event_scanner`

Scans VC/newsletter/event ecosystems.

### 56. `networking_intro_strategy`

Gives practical advice:

- whether to attend
- what kind of crowd to expect
- arrival timing
- intro strategy
- who to talk to
- whether it is worth the evening

---

# B3 — Events, Culture, Nightlife

## Tools

### 57. `concert_discovery`

Finds concerts and live music.

### 58. `mainstream_event_discovery`

Finds mainstream events:

- concerts
- theater
- sports
- comedy
- family shows
- festivals

### 59. `cultural_attractions_finder`

Finds museums, galleries, monuments and cultural landmarks.

### 60. `museum_ticketing_researcher`

Finds museum tickets, hours, closed days, free-entry days and exhibitions.

### 61. `nightlife_fit_finder`

Finds bars, jazz clubs, rooftops, speakeasies, lounges and clubs.

### 62. `family_friendly_event_finder`

Finds family-friendly events and activities.

### 63. `exhibition_calendar_researcher`

Finds temporary exhibitions.

### 64. `festival_calendar_scanner`

Detects festivals.

### 65. `free_events_finder`

Finds free events and activities.

### 66. `last_minute_tickets_finder`

Finds available events tonight/tomorrow.

### 67. `venue_nearby_plan_builder`

Given an event, builds dinner-before, bar-after and route plan.

### 68. `crowd_level_predictor`

Estimates crowd pressure.

### 69. `rainy_day_plan_finder`

Finds indoor plans when weather is bad.

---

# B4 — Corporate / Business Travel

## Tools

### 70. `client_dinner_recommender`

Finds restaurants for client dinners.

### 71. `executive_lounge_finder`

Finds hotel lounges, airport lounges and premium cafés.

### 72. `private_meeting_room_finder`

Finds meeting rooms by hour.

### 73. `business_dress_code_brief`

Recommends clothing by city, weather, industry and meeting type.

### 74. `local_business_protocol_brief`

Gives practical business etiquette.

### 75. `expense_policy_checker`

Checks if a plan violates company travel policy.

### 76. `receipt_collection_assistant`

Tracks missing receipts, invoices, folios and documents.

### 77. `vat_refund_researcher`

Researches VAT refund/tax-free rules.

### 78. `corporate_travel_risk_digest`

Daily Slack digest for travel teams.

### 79. `meeting_commute_planner`

Calculates when to leave for a meeting.

---

# B5 — Sports / Fan Travel

## Tools

### 80. `team_travel_package_builder`

Builds flight + hotel + ticket + transfer + food package around a match.

### 81. `stadium_day_plan`

Plans full match day.

### 82. `away_fan_safety_brief`

Gives cautious advice for away fans.

### 83. `ticket_resale_risk_checker`

Evaluates resale ticket risk.

### 84. `sports_bar_finder`

Finds bars to watch a match.

### 85. `match_postponement_monitor`

Monitors fixture changes.

### 86. `fan_group_coordination_tool`

Coordinates group fan travel.

---

# B6 — Lifestyle / Local Commerce

## Tools

### 87. `shopping_district_brief`

Finds shopping areas by style and budget.

### 88. `local_designer_finder`

Finds local designers, boutiques and concept stores.

### 89. `market_day_finder`

Finds markets and fairs.

### 90. `gift_recommender`

Suggests local gifts by budget and recipient.

### 91. `pharmacy_product_mapper`

Maps common products to local names.

### 92. `electronics_adapter_checker`

Checks plug type, voltage and where to buy adapters.

### 93. `luggage_repair_finder`

Finds luggage repair and urgent fixes.

### 94. `laundry_service_finder`

Finds laundry and pickup services.

### 95. `tailor_urgent_finder`

Finds urgent tailoring.

### 96. `personal_shopper_light`

Builds shopping routes by style.

### 97. `vintage_thrift_finder`

Finds vintage/thrift shops.

### 98. `craft_beer_finder`

Finds taprooms, breweries and beer events.

---

# B7 — Health, Safety, Wellness

## Tools

### 99. `clinic_finder`

Finds clinics, private hospitals and urgent care.

### 100. `pharmacy_24h_finder`

Finds 24h pharmacies.

### 101. `travel_vaccine_researcher`

Researches required/recommended vaccines.

### 102. `food_safety_brief`

Water and food safety brief.

### 103. `allergy_safe_restaurant_finder`

Finds restaurants safe for allergies/dietary needs.

### 104. `emergency_numbers_card`

Local emergency numbers and consulate contacts.

### 105. `embassy_consulate_locator`

Finds embassy/consulate based on nationality.

### 106. `safe_route_home`

Suggests safer route/mode home at night.

### 107. `area_after_dark_check`

Evaluates after-dark suitability of an area.

### 108. `scam_risk_brief`

Common scams by city.

---

# B8 — Trip Intelligence / Anticipation

## Tools

### 109. `city_pulse_brief`

Daily city brief:

- weather
- events
- protests
- closures
- traffic
- holidays
- opportunities
- avoid zones

### 110. `trip_opportunity_ranker`

Ranks opportunities by traveler fit.

### 111. `itinerary_gap_detector`

Finds empty time windows.

### 112. `micro_itinerary_builder`

Builds 2–4 hour mini itineraries.

### 113. `layover_city_escape`

Decides if traveler can leave airport during layover.

### 114. `first_day_soft_plan`

Builds gentle arrival-day plan.

### 115. `last_day_checkout_plan`

Plans gap between hotel checkout and flight.

### 116. `luggage_storage_finder`

Finds lockers/storage.

### 117. `trip_pacing_optimizer`

Avoids overpacked itineraries.

### 118. `weather_replan_engine`

Replans activities based on weather.

### 119. `group_preference_reconciler`

Combines preferences across group travelers.

### 120. `perfect_evening_builder`

Builds a beautiful evening from weather + restaurants + events + route + safety.

### 121. `trip_contextual_recommender`

Recommends from situation, not category.

---

# B9 — Travel Disruption / Policy / Logistics Research

## Tools

### 122. `airport_disruption_monitor`

Checks airport strikes, closures, delays, weather and construction.

### 123. `local_holiday_disruption_check`

Detects holidays, elections, school vacations, closures and protests.

### 124. `venue_policy_checker`

Checks venue rules:

- bag policy
- ID
- entry time
- prohibited items
- accessibility
- parking

### 125. `hotel_area_intelligence`

Scores hotel area by:

- safety
- walkability
- corporate fit
- nightlife
- transit
- nearby essentials

### 126. `neighborhood_fit_matcher`

Matches neighborhoods to traveler profile.

### 127. `restaurant_reservation_researcher`

Checks reservation, deposit, dress code, menu and booking URL.

### 128. `menu_dietary_researcher`

Checks menus for dietary restrictions.

### 129. `ground_transport_price_researcher`

Estimates taxi/Uber/Cabify/bus/train prices.

### 130. `public_transit_ticketing_brief`

Explains how to pay for transit locally.

### 131. `airport_terminal_resolver`

Finds likely terminal, check-in area and lounge options.

### 132. `layover_viability_checker`

Checks connection risk, terminals, immigration, visa transit and baggage.

### 133. `nearby_airport_alternative_researcher`

Researches alternate airports.

### 134. `route_alternative_researcher`

Finds train/bus/ferry/nearby-airport alternatives.

### 135. `trip_budget_researcher`

Estimates local daily spend.

### 136. `local_payment_acceptance_brief`

Explains cash/card/local wallets/ATM norms.

### 137. `invoice_tax_requirements_researcher`

Researches corporate invoice/tax requirements.

### 138. `travel_insurance_requirement_checker`

Checks insurance requirements.

### 139. `medical_access_brief`

Clinics, pharmacies, emergency, private health access.

### 140. `communications_researcher`

Researches local connectivity, networks, coverage and roaming notes.

### 141. `cultural_protocol_brief`

Practical etiquette for local interaction.

### 142. `live_news_trip_risk_scanner`

Scans recent news for risks affecting a trip.

---

# B10 — Agency Ops / Travel Team Automation

## Tools

### 143. `supplier_quote_comparator`

Compares supplier quotes.

### 144. `manual_supplier_researcher`

Finds local suppliers when no API exists.

### 145. `supplier_contact_extractor`

Extracts email, phone, WhatsApp, form URL and hours.

### 146. `supplier_reliability_score`

Scores suppliers from public signals + internal feedback.

### 147. `ops_followup_scheduler`

Schedules follow-ups.

### 148. `booking_gap_auditor`

Finds missing info:

- passport
- passenger
- hotel check-in
- transfer location
- unpaid invoice
- missing receipt

### 149. `handoff_context_builder`

Prepares complete context for human escalation.

### 150. `post_trip_feedback_analyzer`

Turns trip feedback into supplier score and traveler preferences.

### 151. `agency_margin_guard`

Checks margin and commercial policy before recommendations.

### 152. `preferred_supplier_router`

Prioritizes agency-preferred suppliers.

---

# API / data source setup

## Google stack

Use one locked-down Google Cloud project.

Enable:

- Places API New
- Routes API
- Geocoding API
- Address Validation API
- Maps Static API
- Custom Search JSON API / Programmable Search Engine, if using Google search results

Environment variables:

```bash
GOOGLE_MAPS_API_KEY=
GOOGLE_PLACES_API_KEY=
GOOGLE_CUSTOM_SEARCH_API_KEY=
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=
```

Notes:

- Places API New should use FieldMask.
- Nearby Search for radius-based discovery.
- Text Search for natural language venue discovery.
- Place Details for website, phone, opening hours, maps URI, rating, types and photos.
- Routes API for ETA and route ranking.
- Route Matrix for many candidate places against hotel/current location.

## Luma

Use for founder, AI, web3, design, climate, private community and professional networking events.

URLs:

- https://luma.com
- https://help.luma.com/p/luma-api
- https://docs.luma.com/reference
- https://public-api.luma.com

Environment:

```bash
LUMA_API_KEY=
```

## Meetup

Use for local communities, language exchange, tech meetups, running/hiking/social groups.

URLs:

- https://www.meetup.com
- https://www.meetup.com/graphql/
- https://www.meetup.com/graphql/guide/

Environment:

```bash
MEETUP_CLIENT_ID=
MEETUP_CLIENT_SECRET=
MEETUP_ACCESS_TOKEN=
```

## Eventbrite

Use for free/local/community/professional events.

URLs:

- https://www.eventbrite.com/platform/api
- https://www.eventbrite.com/platform/docs/introduction
- https://www.eventbrite.com/platform/docs/api-basics

Environment:

```bash
EVENTBRITE_PRIVATE_TOKEN=
```

## Ticketmaster

Use for mainstream events, concerts, theater, sports, family shows.

URLs:

- https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
- https://developer.ticketmaster.com/products-and-docs/tutorials/events-search/search_events_with_discovery_api.html

Environment:

```bash
TICKETMASTER_API_KEY=
```

## PredictHQ

Use for event intelligence, crowd pressure, demand pressure and city pulse.

URLs:

- https://www.predicthq.com
- https://docs.predicthq.com

Environment:

```bash
PREDICTHQ_ACCESS_TOKEN=
```

## Michelin / 50 Best / official guide sources

Use as official or high-signal web sources, not necessarily APIs.

URLs:

- https://guide.michelin.com
- https://www.theworlds50best.com

## Coworking calendars

Seed source list:

- https://www.wework.com/events
- https://impacthub.net/locations/
- https://talentgarden.org/en/events/
- https://factoryberlin.com/events/
- https://lamaquinita.co
- https://urbanstation.com

## Accelerator calendars

Seed source list:

- https://www.startupgrind.com/events/
- https://www.techstars.com/events
- https://www.ycombinator.com/events
- https://www.antler.co/events
- https://www.plugandplaytechcenter.com/events/
- https://500.co/events
- https://masschallenge.org/events/
- https://endeavor.org/events/

## University entrepreneurship centers

Seed source list:

- https://ecorner.stanford.edu
- https://innovationlabs.harvard.edu/events/
- https://entrepreneurship.mit.edu
- https://calendar.mit.edu
- https://skydeck.berkeley.edu/events/
- https://entrepreneurship.columbia.edu/events/
- https://entrepreneur.nyu.edu/events/
- https://www.jbs.cam.ac.uk/entrepreneurship/

## VC newsletters / event sources

Seed source list:

- https://a16z.com/events/
- https://review.firstround.com
- https://firstround.com/events/
- https://www.sequoiacap.com
- https://www.nfx.com/post
- https://lsvp.com/insights/
- https://www.indexventures.com/perspectives/
- https://www.generalcatalyst.com/insights
- https://www.lennysnewsletter.com
- https://every.to
- https://www.theinformation.com/events
- https://techcrunch.com/events/
- https://sifted.eu/events
- https://www.eu-startups.com/events/

---

# First 20 tools to build

## Phase 1 — Magic personalization

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

## Phase 2 — Food + events

11. `cheap_michelin_finder`
12. `ramen_finder`
13. `foodie_shortlist_builder`
14. `luma_event_discovery`
15. `meetup_event_discovery`
16. `professional_networking_scanner`

## Phase 3 — Date planner

17. `date_budget_optimizer`
18. `date_perfume_advisor`
19. `date_game_tips`
20. `date_plan_builder`

---

# Highest-priority demo

```txt
Build my personal city pack for Tokyo.

I like specialty coffee where I can work, serious ramen under $20,
affordable Michelin/Bib-style restaurants, beautiful date spots,
and founder/AI events.
```

Expected Sendero answer:

```txt
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

---

# README thesis lines

Add under the anticipation / experimental section:

> The first experimental anticipation bucket is the **Hobby-Aware Concierge**: Sendero learns a traveler’s taste graph — specialty coffee, affordable fine dining, ramen, founder events, date spots and local culture — and builds a personalized city pack before the traveler asks. This is the post-app thesis in its most personal form: the city comes to the traveler, already filtered by taste, beauty, budget and context.

Add under the Monocle-Level Taste Engine section:

> Sendero should not recommend “the best places.” It should recommend the best places for your taste, your budget, your context and the moment. The difference between a directory and a concierge is judgment — and judgment requires visual taste, money awareness and deep source research.

Add under the Date Planner section:

> The Romantic Concierge makes Sendero the best date planner in every city: budget-aware, multi-stop, tasteful, weather-aware, route-aware and confidence-building. Great dates are not one reservation; they are a sequence of well-timed moves.

# Sendero Design System

This file is the source of truth for Sendero's product and marketing design direction. It applies to the marketing app, the authenticated app, Storybook, and the shared `@sendero/ui` package.

## Implementation References

- Shared brand tokens: `packages/ui/src/brand/sendero-brand.ts`
- Shared CSS variables: `packages/ui/src/globals.css`
- Storybook brand book: `apps/storybook/stories/brand/BrandBook.stories.tsx`
- Storybook static assets: `apps/storybook/public/brand`
- Design-system brand assets: `packages/ui/brand`
- Dot-grid micro-illustrations: `packages/ui/src/illustrations/dot-grid/`

## Sendero Brand Book

### 1. Brand Overview

**Sendero** is an agent-native travel booking platform.

The brand should feel:

- intelligent
- curious
- editorial
- warm
- guided
- premium but approachable

It should not feel like a generic travel app, a chat product, or a cold corporate SaaS tool. The visual identity should suggest **discovery, planning, route intelligence, and travel perspective**. Sendero is a vertical AI travel agent.

### 2. Core Brand Idea

**Brand metaphor:** Sendero is a smart travel guide with taste.

The identity combines travel exploration, wayfinding, editorial charm, and AI-assisted guidance. The system should feel like a modern travel companion with a slightly literary, observant, map-room sensibility.

### 3. Logo System

#### Primary Platform Icon

**Binocular mark** — a binocular silhouette for discovery/planning/search, a star in the left lens for direction/navigation/intelligence, and a mountain line in the right lens for destination/horizon/travel context.

Communicates: seeing ahead, curated discovery, travel intelligence, perspective, movement toward a destination. The binocular shape is travel-native without being generic, distinct from messaging or aviation icons, flexible across product and editorial surfaces.

### 4. Brand Personality

**Thoughtful** — Not loud, not gimmicky, not trend-chasing.
**Elegant** — Refined editorial taste, not luxury-for-luxury's-sake.
**Adventurous** — Movement, curiosity, a sense of horizon.
**Intelligent** — The AI layer should feel useful and subtle, not robotic.
**Human** — Slight imperfection, texture, and warmth matter.

### 5. Visual Style Principles

#### Core Look

- loose vermillion linework
- visible grain
- subtle distressed print texture
- slightly imperfect registration
- hand-drawn editorial sensibility
- minimalist forms
- calm spacing
- light warm backgrounds
- **layered surfaces on parchment** — depth via shadow, punctuated by editorial hairlines

The authenticated product should read like the marketing root (`/`): warm parchment fields, floating cards with soft shadow, active states as tinted fills, punctuated by hairline rules for editorial rhythm. The console should not feel like a different universe — it should feel like the same map-room, turned toward operations.

#### Motion

Motion should feel like paper, ink, route tracing, and quiet operational state changes.

Use motion for:

- first-load orientation on public editorial pages
- route-line or map-image reveals
- state feedback on pressable controls
- numeral count-up on stat blocks (once on mount)
- dot-grid illustration stroke-draw reveals (on scroll in)
- surface elevation changes (card hover, panel focus)
- tab pill slides (active-state position transitions)

Avoid motion for repeated operator actions, keyboard-driven flows, dense table scanning, or anything that delays a travel agent from acting.

**Default curves:**
- `cubic-bezier(0.23, 1, 0.32, 1)` for entrances, feedback, shadow depth, and pill slides
- `cubic-bezier(0.77, 0, 0.175, 1)` for visible movement already on screen

**Default durations:**
- 160ms — micro-feedback (button press, tint change, sidebar active fill)
- 240ms — surface elevation, tab pill slides
- 320ms — entrances
- 400ms — image reveals inside hovered cards
- 600ms — numeral count-ups, stroke-draw illustration reveals

All motion must respect `prefers-reduced-motion` and collapse transitions to 0ms.

#### Avoid

- shiny startup gradients
- glassmorphism
- generic tech blue as default
- overly sterile geometric perfection
- icons that resemble Telegram, paper planes, or chat apps
- overly literal airplane or travel cliches
- **hard 1px borders as layout separators** — use whitespace and shadow
- **boxed panels stacked edge-to-edge** — panels should breathe and float
- **black frames inside the authenticated app** — terminal surfaces use Midnight Veil, not pure black

### 6. Color System

#### Primary Color

**Vermillion** — `#D65438`

Use for: primary icon, hero branding, headline brand moments, editorial brand surfaces, sidebar-nav active state, primary CTAs, active-state tinted fills (at 10–18% alpha). The main emotional color. Never diluted by using it for tab-active on every tab bar — reserve its presence.

#### Supporting Icon Colors

**Midnight** — `#1F2A44` — trust, console surfaces, body type, shadow tint (at 4–35% alpha), tab-pill active fills, primary dark buttons. Grounded, reliable, intelligent.

**Sea** — `#0F7C82` — travel operations, map features, system accents, informational chips. Calm, navigational, capable.

**Sand** — `#B6844E` — editorial moments, hospitality contexts, pending/awaiting status chips. Warm, cultured, understated.

#### Surface Palette

Sendero uses a **three-tier surface system** with elevation, not borders.

**Parchment — base field** `#EEDCC7` — default page backgrounds, the canvas everything floats on.

**Parchment Light — raised** `#F7EFE4` — primary content cards (trip lists, threads, context panels). The layer where most reading happens.

**Warm White — floating** `#FDFBF7` — popovers, menus, modals, active/selected cards. The topmost interactive surface. Also the text color used on solid-midnight active tab pills.

**Midnight Veil — terminal** `rgba(31, 42, 68, 0.97)` — workflow / console panels. Never pure black.

**Page wash (outermost frame):** radial gradient blending parchment at center with sea at 3% and sand at 4% at the corners, plus a baked grain overlay at 4% opacity. The authenticated app sits on top as a single raised card.

### 7. Surface and Shadow System

**Hierarchy comes from elevation and editorial rhythm, not outlines.**

#### Elevation Tiers

| Tier | Token | Use | Shadow |
|---|---|---|---|
| Base | `--surface-base` | Page field | none |
| Raised | `--surface-raised` | Content cards | `--shadow-md` |
| Floating | `--surface-floating` | Active/selected, popovers | `--shadow-lg` |
| Terminal | `--surface-terminal` | Console, workflow panels | `--shadow-terminal` |
| Frame | `--surface-raised` + `--shadow-xl` | Outermost authenticated app card | `--shadow-xl` |

#### Shadow Tokens

```css
--shadow-xs: 0 1px 2px rgba(31, 42, 68, 0.04);
--shadow-sm: 0 1px 2px rgba(31, 42, 68, 0.04),
             0 4px 12px -6px rgba(31, 42, 68, 0.06);
--shadow-md: 0 1px 2px rgba(31, 42, 68, 0.04),
             0 8px 24px -12px rgba(31, 42, 68, 0.08);
--shadow-lg: 0 2px 4px rgba(31, 42, 68, 0.06),
             0 16px 40px -16px rgba(31, 42, 68, 0.14);
--shadow-xl: 0 2px 4px rgba(31, 42, 68, 0.06),
             0 24px 48px -20px rgba(31, 42, 68, 0.18);
--shadow-terminal: 0 2px 4px rgba(31, 42, 68, 0.12),
                   0 24px 48px -20px rgba(31, 42, 68, 0.35);
```

Rules:
- Shadows are **midnight-tinted**, never pure black.
- No panel has both a shadow and a border. Pick one.
- Hover raises one tier (md → lg). Selected stays at lg.
- No shadows on inline elements, text, or icons.

#### Tint Tokens

```css
--tint-vermillion-soft: rgba(214, 84, 56, 0.10);
--tint-vermillion-medium: rgba(214, 84, 56, 0.18);
--tint-sea-soft: rgba(15, 124, 130, 0.10);
--tint-sand-soft: rgba(182, 132, 78, 0.12);
--tint-midnight-soft: rgba(31, 42, 68, 0.04);
--tint-midnight-medium: rgba(31, 42, 68, 0.08);
```

#### Radius Tokens

```css
--radius-sm: 8px;    /* chips, pills, small buttons */
--radius-md: 12px;   /* list items, inputs */
--radius-lg: 16px;   /* panels, cards */
--radius-xl: 20px;   /* hero surfaces, modals, outer app frame */
```

### 8. Hairlines, Dot Grid, and Editorial Rhythm

Borders exist. But they're **editorial rhythm**, never structural glue.

#### Hairline Tokens

```css
--hairline-color: #D8C1A7;                        /* warm parchment beige */
--hairline-color-soft: rgba(31, 42, 68, 0.08);   /* midnight whisper */
--hairline-color-strong: rgba(31, 42, 68, 0.14); /* midnight readable */
--hairline: 1px solid var(--hairline-color);
--hairline-soft: 1px solid var(--hairline-color-soft);
--hairline-strong: 1px solid var(--hairline-color-strong);
```

#### Hairlines Are Allowed In

- Between stat cells in `<MetricRow>` (vertical).
- Between feature columns in marketing editorial grids.
- Between table rows when row height < 44px (`--hairline-color-soft`).
- Around `<CaseStudyCard>` and `<AgentCard>` outer containers (`--hairline-color`).
- Under a tab bar as baseline for the vermillion active line in `<UnderlineTabs>`.
- Above footers and below page headers on marketing surfaces as rhythm breaks.
- Composer on focus: 1px vermillion at 40% — the one focus-border in the app.

#### Hairlines Are Forbidden In

- App shell panel separators (sidebar-to-content, list-to-detail, header-to-body).
- Empty states (dashed or otherwise).
- Inside cards as internal dividers when whitespace would do the work.

**Load-bearing test:** if removing the hairline breaks layout comprehension, the layout is wrong. Hairlines are rhythm, not glue.

#### Dot-Grid Tokens

```css
--dot-grid-color: rgba(31, 42, 68, 0.18);
--dot-grid-size: 8px;
--dot-grid-pattern:
  radial-gradient(circle, var(--dot-grid-color) 1px, transparent 1px)
  0 0 / var(--dot-grid-size) var(--dot-grid-size);
```

The dot grid is the graticule behind micro-illustrations and an ambient texture in empty states. It references map graticules and graph paper — travel planning lives on grids.

### 9. Color Usage Guidance

**Default Hierarchy:**
1. **Vermillion** — sidebar nav active, primary CTAs, editorial brand moments. Used sparingly.
2. **Midnight** — body type, console, tab-pill active fills, shadow tint.
3. **Sea** — travel ops, web/channel tags, system accents.
4. **Sand** — awaiting/pending status, warm editorial.

Use tinted fills (10–18% alpha) for backgrounds; reserve full saturation for text, icons, and key accents. **Solid midnight is the default for tab-active pills**, so vermillion stays precious.

### 10. Typography Direction

Editorial, elegant, legible, slightly literary, premium but not ornate.

- Serif for the wordmark, headlines, and oversized metric numerals.
- Restrained sans or simple serif for product/body.
- Monospace only for workflow/terminal surfaces and data tables.

Travel magazine meets intelligent product company.

#### Opacity Scale for Type

Use midnight at varying alpha instead of grey ramps:

- 100% — primary headlines, body, display numerals
- 70% — secondary body, sidebar items at rest, illustration linework
- 60% — meta info (timestamps, labels, status bar)
- 50% — ambient/comment text in console surfaces
- 40% — placeholder, disabled

#### Numeral Scale

```css
--numeral-xl: clamp(3.5rem, 6vw, 5.5rem);    /* stat headliners (100%, +150, 3331) */
--numeral-lg: clamp(2.75rem, 4.5vw, 4rem);   /* dashboard kpis */
--numeral-md: clamp(2rem, 3vw, 2.75rem);     /* card kpis */
```

All numerals use `font-variant-numeric: tabular-nums`. Currency symbols scale to 0.8em and baseline-align, or use `font-feature-settings: "sups"` where the face supports it.

#### Small-Caps Label

```css
--label-meta: 0.6875rem;  /* 11px */
--label-meta-tracking: 0.12em;
```

Use `font-feature-settings: "c2sc", "smcp"` if the typeface supports it; else synthesize with uppercase + 0.12em tracking.

#### Body Rhythm

- UI line-height: 1.5
- Marketing line-height: 1.6
- Long-form editorial line-height: 1.7
- Paragraph max width: `max-inline-size: 72ch`

### 11. Illustration Direction

Illustration should support the brand, not overpower it.

**Preferred traits** — hand-drawn linework, path motifs, stamp/seal references, route logic, subtle explorer cues, horizon imagery, print texture, limited palette, dot-grid graticule framing.

**Avoid** — cartoon overload, literal AI robots, overly futuristic UI, excessive detail at small sizes.

#### Dot-Grid Micro-Illustrations (Canonical Set)

Seven illustrations, each an SVG component with a `tone` prop. Anchor linework to the 8px dot grid.

1. **Route curve** — S-curve with endpoint dots. Trip/itinerary stages.
2. **Bar cluster** — 6–7 vertical bars, one elevated with downward chevron. Distribution views.
3. **Peaked line** — jagged line graph with dots. Monitoring, latency.
4. **Fanout** — point fanning to 5–6 targets. Commission, one-to-many.
5. **Bouncing path** — two arcs meeting the baseline. Claims, retries, handoffs.
6. **Connected nodes** — 3 rectangles with connecting paths. Integrations, custom flows.
7. **Binocular field** — two concentric circles with a horizon line. Sendero-native. Discovery, intake, search.

On scroll into view, strokes draw left-to-right over 600ms via `useStrokeDraw()`. Reduced-motion safe.

### 12. Postcard Storytelling System

The landing page uses the `sendero-3` postcard series: Seal → Tag → Bind → Clear → Settle → Deliver. Put postcards on parchment, not white cards. Let the art sit large enough to inspect grain, borders, and route marks. Postcards are also used inside `<CaseStudyCard>` right-column hero imagery — the vermillion grain reads as a premium editorial photograph.

### 13. Product UI Patterns

#### App Shell

- Outermost frame: body has a radial gradient blending parchment with whispers of sea and sand, plus a 4%-opacity grain overlay.
- On top: the authenticated app is a single raised card with `--shadow-xl`, rounded `--radius-xl`, `--surface-raised` fill, 24px viewport margin on large screens. The product feels like *a document on a desk*.
- Inside the card: the three-column layout (sidebar / list / detail) uses whitespace and surface tiers, no borders between regions.
- The workflow/terminal panel floats as its own dark card with `--shadow-terminal`, rounded `--radius-lg`.

#### Sidebar Items

- Inactive: transparent, midnight text at 70%.
- Hover: `--tint-midnight-soft` fill, rounded-md.
- Active: `--tint-vermillion-soft` fill, vermillion text, rounded-md. Fade in over 160ms on transition. No left bar, no border.
- Section headers get a subtle `+` expander on the right.

#### List Items (Trip Inbox)

- Each item: raised card, 12px padding, `--surface-raised`, no border.
- Hover: elevate to `--shadow-lg`.
- Selected: `--surface-floating`, `--shadow-lg`, plus a 2px vermillion inset on the left edge (pseudo-element, not border).
- Status chips: pill-shaped, no border, tinted fill:
  - `WEB` → `--tint-sea-soft`, sea text
  - `AWAITING_APPROVAL` → `--tint-sand-soft`, sand text
  - `AI ON` → `--tint-vermillion-soft`, vermillion text
  - Urgent → solid vermillion

#### Metric Rows

Use `<MetricRow>` for dashboard KPIs:

- Horizontal row of 4 cells, equal width, 48px vertical / 24px horizontal padding.
- Oversized numeral (`--numeral-xl`, serif, midnight 100%, tabular-nums).
- Small-caps label below (`--label-meta`, midnight 60%, tracking-wide).
- `border-right: var(--hairline)` between cells; last cell none.
- No card background, no shadow, no outer border. Sits directly on parchment (or inside the app-frame card at section level).
- Count-up animation on mount via `useCountUp()`, 600ms. Currency fades in instead.
- Responsive: 2×2 grid below 768px, hairlines both axes.

#### Tabs

**Pill Tabs** (`<PillTabs>`) — horizontal row of label pills, active pill fills solid midnight with warm-white text, slides between positions via Framer Motion `layoutId`, 240ms. No container border.

**Underline Tabs** (`<UnderlineTabs>`) — for editorial surfaces. Plain text labels, active gets a 2px vermillion line beneath, sliding via `layoutId`. Baseline hairline under the row.

**Agent / Human toggle stays a tinted segmented control** — it's a binary operator toggle; sliding pills would be overkill.

#### Steppers

`Intake → Search → Review → Hold → Pay → Settle` — each step a small pill.

- Active: vermillion tinted fill with a micro vermillion dot, `--shadow-xs`.
- Completed: sea tinted fill with a checkmark.
- Upcoming: transparent, midnight at 60%.

#### Composer

- No top border between composer and thread. 24px gap.
- Raised card, `--shadow-sm` at rest, `--shadow-md` on focus.
- On focus, a 1px vermillion-at-40% border fades in over 160ms (the one focus-border in the app).
- Send button: vermillion pill, solid fill, no border.

#### Filter Pill Group

`<FilterPillGroup>` — search input + dropdown pills + action pill, all rounded-full with `--hairline-soft` border on `--surface-raised`. 12px gap. Hover raises pills to `--shadow-xs`.

#### Empty States

- No dashed borders. Ever.
- `--surface-base` (parchment) inside a raised card with 32px padding.
- Small binocular mark at 20% opacity, centered above the headline.
- Dot grid behind the mark breathes between 30% and 40% opacity over a 4s cycle (pauses under reduced-motion).
- Editorial copy tone: observational, not instructional.

#### Workflow / Terminal Panel

- Background: `--surface-terminal` (midnight at 97%, parchment whispers through). **Never pure black.**
- Rounded `--radius-lg`, `--shadow-terminal`.
- Headers in monospace, warm off-white.
- `RUN` / `STREAM` buttons: pill-shaped, no border. `RUN` vermillion tint, `STREAM` sea tint.
- Table rows: no horizontal rules, 8px vertical rhythm, labels at 50% opacity.
- Comment lines at 50% opacity, 12px left inset.
- Toggleable per trip — operators can show or hide without losing other chrome.

#### Status Bar

- Floats on the app-frame card, no top border.
- Inline text, dots-separated, monospace, midnight at 60%.
- Floating pills (`2 Issues`, round action button) use `--shadow-lg`, no border.

### 14. Marketing Patterns

#### Marketing Stat Row

The hero stat row: no card, no shadow, no background. 4 oversized numerals on parchment, vertical hairlines between cells. 120px vertical padding, 96px whitespace before next section.

#### Case Study Card

`<CaseStudyCard>` — 1fr/1fr grid, columns meeting at a hairline, outer `--hairline` border, rounded `--radius-lg`, overflow hidden. Left column: editorial text with a "CASE STUDY" small-caps pill, large serif headline, "View full case study →" at bottom. Right column: `sendero-3` postcard imagery. Hover elevates the card to `--shadow-md` and scales the image to 1.02 over 400ms.

#### Feature Grid

`<FeatureGrid variant="hairline">` — 4-column grid, vertical `--hairline-soft` between columns, no card wrappers. Each cell has a dot-grid micro-illustration on top and headline + paragraph below. Scroll-in staggers the stroke-draw animation with 80ms delay between cells.

#### Agent Card

`<AgentCard>` — rounded `--radius-lg`, `--hairline` border, no shadow at rest. Top: dot-grid illustration area (`--surface-raised`, dot pattern at 40%, 56px padding). Bottom: 32px content padding, headline with a status pill (BETA, ENTERPRISE, COMING SOON), 2-line description, footer action (plain "Coming soon" at 60% OR a solid midnight rounded-full button with arrow). Vermillion reserved for primary sign-up actions only. Hover elevates to `--shadow-md`, illustration strokes draw.

### 15. Borders — The Full Rule Set

**Allowed:**
- Form inputs on focus (1px vermillion at 40%)
- Text inputs and textareas at rest (`--hairline-soft`)
- Hairlines between cells in `<MetricRow>`, columns in `<FeatureGrid>`, rows in dense tables
- Outer containers for `<CaseStudyCard>` and `<AgentCard>` (`--hairline`)
- 2px vermillion inset on selected list items (pseudo-element, not true border)
- 2px vermillion active-tab underline in `<UnderlineTabs>`
- Marketing editorial rhythm rules (section transitions)

**Forbidden:**
- Sidebar-to-content separators
- List-to-detail separators
- Header-to-body separators
- Top-bar-to-content separators
- Status-bar-to-content separators
- Empty-state borders (dashed or otherwise)
- Panel-internal dividers where whitespace suffices
- Any pure-black border anywhere

### 16. Brand Tone In Product

Sendero should look like it: understands travel deeply, reduces chaos, guides you with taste, sees possibilities before you do. A trusted editorial travel guide with intelligence.

### 17. Positioning Summary

**Sendero is an intelligent travel brand built around guidance, perspective, and discovery.** Its identity should feel warm, distinctive, editorial, and quietly capable.

### 18. Quick Usage Cheat Sheet

**Colors** — Vermillion `#D65438` · Midnight `#1F2A44` · Sea `#0F7C82` · Sand `#B6844E`

**Surfaces** — Parchment base → Parchment Light raised → Warm White floating → Midnight Veil terminal

**Shadows** — xs → sm → md → lg → xl → terminal

**Hairlines** — warm parchment beige or midnight at 8%, never pure black

**Numerals** — serif display, tabular-nums, paired with small-caps labels

**Active states** — sidebar uses vermillion tint; tab pills use solid midnight; vermillion stays precious

**Primary icon meaning** — discovery + wayfinding + destination intelligence

### 19. Three-Line Internal Brand Rule

**Sendero should feel like an intelligent explorer's mark, not a generic travel app logo.**

**Sendero's product should feel like a calm map-room of floating cards on parchment, not a grid of bordered boxes.**

**Hairlines are editorial rhythm; shadows are structure; vermillion is precious.**
### 20. Sidebar Hover-Card Pattern

The dashboard sidebar's footer rail uses a single composable pattern for
high-context affordances: a `SidebarMenuButton` row that doubles as a
`HoverCardTrigger`. On hover (right-side, portaled to escape the
sidebar's `overflow:hidden`), a card pops out with explainer copy plus
1–2 primary CTAs.

Variants in production today:

- **Brand · plan card** (`<BrandUpgradeCard />`) — the bottom logo
  reveals the current Clerk plan and an Enterprise upgrade pitch (with
  whitelabel / SSO / audit copy). Org `imageUrl` swaps in for the
  Sendero mark on Enterprise.
- **`Docs · MCP`** (`<LlmsDocsCard />`) — explains MCP + llms.txt with
  three plain-English use cases (travel ops, corporate, builders) and
  a Pro upgrade CTA when MCP isn't unlocked.
- **`Help · Support`** (`<HelpDocsCard />`) — docs link + WhatsApp
  message-us CTA + email fallback.
- **`Setup`** (`<OperatorOnboardingCard />`) — vertical white "egg"
  pill in the rail with a per-plan onboarding checklist. Items
  filtered by plan tier; auto-detects org existence + member count
  from Clerk; manual checks persist to localStorage. Hides itself
  once the operator's tier is fully complete.

The shared rules:
1. Trigger row is full-width edge-to-edge between hairline dividers
   (`border-b color-mix(--ink 24%)`), `py-6` for breathing room.
2. Icons are vermilion (`text-[color:var(--ink)]`) so the rail reads
   as a sequence of bookmarks.
3. Card body uses 3 sections: header (icon + kicker + label + plan
   badge), explainer paragraph, two-button CTA row (outline + filled).
4. Cards return `null` when not applicable to the current plan, so
   the rail trims itself per tier — never shows dead pitch surface.
5. All hover cards portal (`HoverCardPrimitive.Portal`) and bump
   `z-[60]` so they escape the sidebar's stacking context.

### 21. Topography CTA Pattern

The dashboard's `Open agent console` button uses a topography-fill
hover treatment that mirrors the page background's contour-line
pattern. Available as the `topography` `Button` variant
(`packages/ui/src/components/button.tsx`) or the higher-level
`<TopographyButton>` wrapper.

Visual mechanics:
1. **At rest**: outline button on parchment, ink-tinted border at 22%.
2. **On hover**: a vermilion fill, masked by `topography.svg`, slides
   in from the bottom-left and scales up over 280–420ms with
   `cubic-bezier(0.22, 1, 0.36, 1)` (no overshoot).
3. **Label treatment**: gets a "selection rectangle" — vermilion fill
   + 1px inset hairline + white text — so the phrase reads like a
   highlighted text selection.
4. **Reduced motion**: keeps the fill but skips the slide.

Use the `data-variant="ink"` `<TooltipContent>` modifier when pairing a
tooltip with this button — same vermilion topography on a darker base
keeps the visual chord intact.

### 22. Animated Numbers In The Footer Rail

Sub-second telemetry (Arc block#, gas, nano-USDC paid) needs animation
that doesn't bounce or thrash. Two strategies, both in
`apps/app/components/footer-numbers.tsx`:

- **`<DigitTicker>`** — per-digit vertical slide. Only the digit that
  actually changed moves; the rest stay still. `ease-out-quart` over
  420ms. Best for monotonic counters (block#, calls).
- **`<SmoothNumber>`** — tight spring around `<AnimatedNumber>`. Two
  cadence presets:
    - `fast` (mass 0.5 / stiffness 220 / damping 28) — settles in
      ~250ms with no overshoot. Used for gas + paid USDC.
    - `calm` (the editorial default) — used for treasury balances and
      dashboard stat cards.

Both honor `prefers-reduced-motion`: ticker snaps; spring `jump()`s.

### 23. Computer-Use Shortcuts

Every dashboard hotkey is registered globally in
`apps/app/components/use-app-hotkeys.ts` (mounted in `AppChrome`) and
mirrored as a `Computer Use Shortcuts` section in `llms.txt` so
browser-driving agents can list and execute them deterministically.

Two registers:
- **Action chord**: `mod+shift+<letter>` opens a wallet dialog. Mod-prefixed so it never collides with text input.
- **"Go" chord**: `g <letter>` (Linear-style, 1s window) for navigation. Suppressed inside `<input>` / `<textarea>` / `[cmdk-input]` / `contentEditable`.

When adding a shortcut, update both `HOTKEY_MANIFEST` *and*
`computerUseShortcutsSection()` in `packages/llms/src/catalog.ts`.

### 24. Operator Onboarding Card Pattern

The sidebar's `<OperatorOnboardingCard />` is a per-tenant B2B
checklist surface. Three rules keep it consistent with the rest of the
sidebar lockup:

1. **Same row pattern as `Docs · MCP` / `Help · Support`** — full-width
   `SidebarMenuButton` between hairlines, vermilion `ListChecks` icon,
   `py-6` padding. Trailing `n/m` pill in vermilion-soft.
2. **HoverCard reveals the full checklist.** Right-side, portaled,
   `z-[60]`. Each item: green check-square + label + detail line.
   Items link to their resolution route; the check toggle persists
   manual completion to localStorage.
3. **Per-plan filtering.** Each `ChecklistItem` has a `minPlan`. Items
   above the org's tier are hidden. Once everything in the visible set
   is done, the card returns `null` — the rail stays quiet for mature
   workspaces.

The card plugs in between `SidebarContent` and the footer's
`Docs · MCP` row, with hairline dividers above and below. It is *not*
the place for individual-traveler onboarding (that lived in the older
`TravelerOnboardingCard` and was removed from the dashboard surface).

### 25. Token Update — `--surface-raised`

`--surface-raised` was retuned from `#f7efe4` to `#E8DFD2` (slightly
warmer, more saturated parchment). Updated in both
`apps/app/app/globals.css` and `packages/ui/src/globals.css` so all
surface-raised cards (StatCards, PlanTeaser, recent-trips, settings
panels) sit on the same field.

### 26. Settings → API Keys Migration

Per the DX journey, key minting + MCP wiring instructions are
single-page. `/dashboard/integrations/mcp` now renders the API keys
panel directly (imports the existing `ApiKeysPage` body), and the
sidebar nav entry is renamed `API keys / MCP`. The standalone
`/dashboard/settings/api-keys` route still resolves but the canonical
operator surface is the integrations page.

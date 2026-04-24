# Sendero Design System

This file is the source of truth for Sendero's product and marketing design direction. It applies to the marketing app, the authenticated app, Storybook, and the shared `@sendero/ui` package.

## Implementation References

- Shared brand tokens: `packages/ui/src/brand/sendero-brand.ts`
- Shared CSS variables: `packages/ui/src/globals.css`
- Storybook brand book: `apps/storybook/stories/brand/BrandBook.stories.tsx`
- Storybook static assets: `apps/storybook/public/brand`
- Design-system brand assets: `packages/ui/brand`

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

The identity combines:

- travel exploration
- wayfinding
- editorial charm
- AI-assisted guidance

The system should feel like a modern travel companion with a slightly literary, observant, map-room sensibility.

### 3. Logo System

#### Primary Platform Icon

**Binocular mark**

This is the core platform icon.

It combines:

- a **binocular silhouette** for discovery, planning, and search
- a **star** in the left lens for direction, navigation, and intelligence
- a **mountain line** in the right lens for destination, horizon, and travel context

#### What The Icon Communicates

- seeing ahead
- curated discovery
- travel intelligence
- perspective
- movement toward a destination

#### Why It Works

The binocular shape is:

- travel-native without being generic
- distinct from messaging or aviation icons
- flexible across product, app, deck, and editorial surfaces
- simple enough to scale well

### 4. Brand Personality

**Thoughtful**

Not loud, not gimmicky, not trend-chasing.

**Elegant**

A refined editorial taste, not luxury-for-luxury's-sake.

**Adventurous**

There is movement, curiosity, and a sense of horizon.

**Intelligent**

The AI layer should feel useful and subtle, not robotic.

**Human**

Slight imperfection, texture, and warmth matter.

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
- **borderless layered surfaces** — depth via shadow, not dividers

#### Motion

Motion should feel like paper, ink, route tracing, and quiet operational state changes.

Use motion for:

- first-load orientation on public editorial pages
- route-line or map-image reveals
- state feedback on pressable controls
- small image focus changes on hover
- docs/help content entering without layout shift
- **surface elevation changes** (card hover, panel focus)

Avoid motion for:

- repeated operator actions
- keyboard-driven flows
- dense table scanning
- anything that delays a travel agent from acting

Default curves:

- `cubic-bezier(0.23, 1, 0.32, 1)` for entrances, feedback, and shadow depth transitions
- `cubic-bezier(0.77, 0, 0.175, 1)` for visible movement already on screen

Default durations:

- 160ms for micro-feedback (button press, tint change)
- 240ms for surface elevation (shadow depth)
- 320ms for entrances

All motion must respect `prefers-reduced-motion` and collapse to 0ms for shadow transitions.

#### Avoid

- shiny startup gradients
- glassmorphism
- generic tech blue as default
- overly sterile geometric perfection
- icons that resemble Telegram, paper planes, or chat apps
- overly literal airplane or travel cliches
- **hard 1px borders as layout separators** — use whitespace and shadow instead
- **boxed panels stacked edge-to-edge** — panels should breathe and float

### 6. Color System

#### Primary Color

**Vermillion**
`#D65438`

Use for:

- primary icon
- hero branding
- headline brand moments
- editorial brand surfaces
- key product identity moments
- active-state tinted fills (at 10–18% alpha)

This is the main emotional color of the brand. It carries warmth, visibility, and distinction.

#### Supporting Icon Colors

**Midnight**
`#1F2A44`

Use for:

- dark mode
- formal presentations
- trust-heavy surfaces
- documentation
- neutral product contexts
- shadow tinting (at 4–35% alpha)

Tone: grounded, reliable, intelligent.

**Sea**
`#0F7C82`

Use for:

- travel operations
- map-related features
- system accents
- product moments needing freshness or utility
- informational chips and tags

Tone: calm, navigational, capable.

**Sand**
`#B6844E`

Use for:

- editorial moments
- hospitality contexts
- warm supporting applications
- softer secondary branding
- pending/awaiting status chips

Tone: warm, cultured, understated.

#### Surface Palette

Sendero uses a **three-tier surface system** to create elevation without borders.

**Parchment — base field**
`#EEDCC7`

- default page backgrounds
- old-paper editorial surfaces
- map and illustration fields
- the canvas everything else floats on

**Parchment Light — raised**
`#F7EFE4`

- primary content cards (trip lists, threads, context panels)
- default product surface
- the layer where most reading happens

**Warm White — floating**
`#FDFBF7`

- popovers, menus, modals
- the active/selected card in a list
- the topmost interactive surface

**Midnight Veil — terminal**
`rgba(31, 42, 68, 0.97)`

- workflow / console panels
- developer-facing surfaces
- the console voice, but with a whisper of parchment bleeding through at the edges

**Decision:** keep `#EEDCC7` as the dominant page field. Raised cards use the slightly lighter `#F7EFE4` so elevation reads without white-chrome feel. The new postcard assets add enough blue water, olive land, black linework, and vermillion route marks to keep the palette from becoming monotone cream.

### 7. Surface and Shadow System

This is the core structural rule of Sendero's product UI: **hierarchy comes from elevation, not outlines.**

#### Three Elevation Tiers

| Tier | Token | Use | Shadow |
|---|---|---|---|
| Base | `--surface-base` | Page field | none |
| Raised | `--surface-raised` | Content cards | `--shadow-md` |
| Floating | `--surface-floating` | Active/selected, popovers, modals | `--shadow-lg` |
| Terminal | `--surface-terminal` | Console, workflow panels | `--shadow-terminal` |

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

#### Rules

- Shadows are always **midnight-tinted**, never pure black. This keeps the warmth of the parchment field.
- Never stack shadows with borders. Pick one — in Sendero, pick shadow.
- Hover raises one tier (md → lg). Selected stays at floating (lg).
- Do not use shadows on inline elements, text, or icons.

#### Tint Tokens

Used for active-state fills, chip backgrounds, and hover states. Never as primary fills.

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
--radius-xl: 20px;   /* hero surfaces, modals */
```

### 8. Color Usage Guidance

#### Default Hierarchy

1. **Vermillion** = main brand expression, primary actions, active states
2. **Midnight** = trust, console surfaces, body type, shadow tint
3. **Sea** = functional travel accents, web/channel tags
4. **Sand** = warm editorial, awaiting/pending status

#### Rule

The alternate colors support the system. They do **not** replace the primacy of vermillion. Use tinted fills (10–18% alpha) for backgrounds; reserve full saturation for text, icons, and key accents.

### 9. Borders — When Allowed

Borders are **not** a structural tool. They are allowed only in these cases:

- Form inputs on focus (1px vermillion at 40% opacity)
- Text inputs and textareas at rest (1px midnight at 8% opacity — the lightest whisper)
- Table rows in dense data views, if density exceeds readable spacing
- Inset indicators inside selected cards (e.g., a 2px vermillion line on the left edge *inside* a card, not a border)

Never use borders to separate:

- Sidebar from main content
- List from detail panel
- Header from body
- Top bar from content
- Status bar from content
- Sections of the same panel

Use whitespace, shadow, or a surface-tier change instead.

### 10. Icon Usage

#### Use The Icon When

- space is limited
- the full wordmark is unnecessary
- the platform needs a recognizable shorthand
- app/product surfaces need a compact identity mark

#### Use The Wordmark + Icon When

- presenting the full brand
- landing pages
- pitch decks
- brand introductions
- external-facing communications

### 11. Clear Space

Always leave breathing room around the icon.

**Minimum clear space:** at least **25% of the icon's width** on all sides.

Do not crowd it with:

- text
- buttons
- borders
- other logos
- busy illustrations

The icon works best when it has room to sit calmly.

### 12. Minimum Size

#### Digital

- minimum: **24 px height**
- preferred: **64 px and above**

#### Print

- minimum: **12 mm height**

Below these sizes, texture may be reduced if necessary, but the shape must stay intact.

### 13. Construction Principles

The icon should preserve these elements:

- rounded binocular body
- balanced two-lens structure
- star in left lens
- mountain line in right lens
- single-color outline logic
- simple internal detail

Do not alter the internal symbols casually.

### 14. Do / Don't

#### Do

- use a single solid color
- keep proportions intact
- place on calm, high-contrast backgrounds
- preserve the mark exactly
- use it with restraint and confidence

#### Don't

- stretch or squash the icon
- add drop shadows on the icon itself (the icon is flat; elevation lives on surfaces, not marks)
- add gradients
- put it on noisy backgrounds
- over-outline it
- rotate it arbitrarily
- replace the star or mountain with random symbols

### 15. Background Applications

#### Best Background Types

- warm off-white
- soft cream
- old parchment `#EEDCC7`
- muted neutrals
- deep midnight fields
- calm pale map tones
- lightly textured editorial surfaces

#### Avoid Backgrounds That Are

- too busy
- low contrast
- hyper-saturated
- glossy or synthetic
- visually competitive with the mark

### 16. Typography Direction

The typography should feel:

- editorial
- elegant
- legible
- slightly literary
- premium but not ornate

#### Best Fit

- serif for the main wordmark/headlines
- restrained supporting sans or simple serif for product/body use
- monospace (JetBrains Mono or similar) only for the workflow/terminal surfaces and data tables

The overall balance should feel like **travel magazine meets intelligent product company**.

#### Opacity Scale for Type

Use midnight at varying alpha instead of grey ramps:

- 100% — primary headlines and body
- 70% — secondary body, sidebar items at rest
- 60% — meta info (timestamps, labels, status bar)
- 50% — ambient/comment text in console surfaces
- 40% — placeholder, disabled

### 17. Illustration Direction

Illustration should support the brand, not overpower it.

#### Preferred Traits

- hand-drawn linework
- path motifs
- stamp/seal references
- route logic
- subtle explorer cues
- horizon imagery
- print texture
- limited palette

#### Avoid

- cartoon overload
- literal AI robots
- overly futuristic UI imagery
- excessive detail at small sizes

### 18. Postcard Storytelling System

The landing page should use the `sendero-3` postcard series as the strongest storytelling asset.

Use the postcards for:

- route custody and chain-of-action moments
- escrow, approval, and settlement explanations
- handoff states between traveler, agency, company, and AI agent
- above-the-fold or mid-page editorial proof that Sendero is not generic AI SaaS

The postcard sequence should read as:

1. **Seal** — secure the request.
2. **Tag** — attach traveler and policy context.
3. **Bind** — bundle proofs, holds, and claims.
4. **Clear** — approve the itinerary before irreversible action.
5. **Settle** — reconcile money, rails, and invoices.
6. **Deliver** — send the final record back to the right parties.

Layout guidance:

- Put postcards on parchment fields, not white cards.
- Let the art sit large enough to inspect grain, borders, and route marks.
- Use simple captions under the art; do not over-explain the image inside a framed card.
- A light asymmetric rotation is acceptable for individual postcards, but do not rotate the binocular mark.
- Avoid displaying contact sheets with checkerboard backgrounds in production UI; store them as source/reference assets.

### 19. Product UI Patterns

These patterns apply to the authenticated app (workspace, trip inboxes, agent console, ops workspace, trips, money & policy, channels, settings).

#### App Shell

- Sidebar, top bar, and status bar sit directly on the parchment field. No borders between them.
- The three-column layout (list / thread / context) uses whitespace and surface tiers for separation.
- The workflow/terminal panel floats as its own dark card with rounded corners and the terminal shadow.

#### Sidebar Items

- Inactive: transparent background, midnight text at 70% opacity.
- Hover: `--tint-midnight-soft` fill, rounded-md.
- Active: `--tint-vermillion-soft` fill, vermillion text, rounded-md. No left bar, no border.
- Section headers get a subtle `+` expander on the right.

#### List Items (Trip Inbox)

- Each item is a raised card with 12px padding, `--surface-raised`, no border.
- Hover: elevate to `--shadow-lg`.
- Selected: `--surface-floating`, `--shadow-lg`, plus a 2px vermillion inset on the left edge (pseudo-element, not border).
- Status chips are pill-shaped, no border, tinted fill:
  - `WEB` → `--tint-sea-soft`, sea text
  - `AWAITING_APPROVAL` → `--tint-sand-soft`, sand text
  - `AI ON` → `--tint-vermillion-soft`, vermillion text
  - Active/urgent → solid vermillion at full saturation

#### Steppers

- `Intake → Search → Review → Hold → Pay → Settle` — each step is a small pill.
- Active: vermillion tinted fill with a micro vermillion dot, `--shadow-xs`.
- Completed: sea tinted fill with a checkmark.
- Upcoming: transparent, midnight at 60% opacity.
- Connector lines between steps are midnight at 20% opacity, 1px, dashed only where the path is speculative.

#### Composer

- No top border separating composer from thread. 24px gap instead.
- Composer is a raised card with `--shadow-sm`, focus raises to `--shadow-md`.
- Send button is a vermillion pill, solid fill, no border.

#### Segmented Controls

- `Agent | Human`, `EN MX BR AR`, channel switcher: all use the same pattern.
- Container has `--surface-raised` fill and `--shadow-xs`.
- Active segment has `--tint-vermillion-soft` fill.
- No borders anywhere.

#### Empty States

- No dashed borders on empty states. Ever.
- Use `--surface-base` (parchment) inside a raised card, with 32px padding.
- Center-align a small binocular mark at 20% opacity above the headline.
- Editorial copy tone: observational, not instructional. E.g., "Start a thread on this trip" > "Click here to start a thread."

#### Workflow / Terminal Panel

- Background: `--surface-terminal` (midnight at 97% opacity — parchment whispers through).
- Rounded 16px, `--shadow-terminal`.
- Headers (WORKFLOW, NANOPAYMENTS, etc.) in monospace, warm off-white.
- `RUN` / `STREAM` buttons: pill-shaped, no border. `RUN` uses vermillion tinted fill; `STREAM` uses sea tinted fill.
- Table rows (`run_id`, `model`, `tools`): no horizontal rules. 8px vertical rhythm, labels at 50% opacity.
- Comment lines (`// no runs yet`) at 50% opacity, 12px left inset.

#### Status Bar

- Floats on parchment, no top border.
- Inline text, dots-separated, monospace, midnight at 60% opacity.
- Floating pills (`2 Issues`, round action button) use `--shadow-lg` and no border.

### 20. Brand Tone In Product

Sendero should look like it:

- understands travel deeply
- reduces chaos
- guides you with taste
- sees possibilities before you do

It should feel more like a **trusted editorial travel guide with intelligence** than a generic booking engine.

### 21. Positioning Summary

**Sendero is an intelligent travel brand built around guidance, perspective, and discovery.**

Its identity should feel warm, distinctive, editorial, and quietly capable.

The binocular icon is the clearest expression of this idea because it represents:

- looking ahead
- seeing clearly
- choosing better routes
- finding meaningful destinations

### 22. Quick Usage Cheat Sheet

**Primary icon color:** Vermillion `#D65438`
**Alt 1:** Midnight `#1F2A44`
**Alt 2:** Sea `#0F7C82`
**Alt 3:** Sand `#B6844E`

**Surface tiers:** Parchment base → Parchment Light raised → Warm White floating → Midnight Veil terminal

**Shadow scale:** xs → sm → md → lg → xl → terminal

**Primary icon meaning:** discovery + wayfinding + destination intelligence

**Best use cases for the binocular icon:**

- app icon
- favicon
- nav bar mark
- social avatar
- onboarding screens
- product surfaces
- travel ops views
- deck cover accent

### 23. Two-Line Internal Brand Rule

**Sendero should feel like an intelligent explorer's mark, not a generic travel app logo.**

**Sendero's product should feel like a calm map-room of floating cards, not a grid of bordered boxes.**
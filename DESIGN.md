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

It should not feel like a generic travel app, a chat product, or a cold corporate SaaS tool. The visual identity should suggest **discovery, planning, route intelligence, and travel perspective**.

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

#### Avoid

- shiny startup gradients
- glassmorphism
- generic tech blue as default
- overly sterile geometric perfection
- icons that resemble Telegram, paper planes, or chat apps
- overly literal airplane or travel cliches

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

Tone: grounded, reliable, intelligent.

**Sea**
`#0F7C82`

Use for:

- travel operations
- map-related features
- system accents
- product moments needing freshness or utility

Tone: calm, navigational, capable.

**Sand**
`#B6844E`

Use for:

- editorial moments
- hospitality contexts
- warm supporting applications
- softer secondary branding

Tone: warm, cultured, understated.

#### Surface Color

**Parchment**
`#EEDCC7`

Use for:

- default page backgrounds
- old-paper editorial surfaces
- map and illustration fields
- brand-safe app surfaces behind generated assets

Tone: warm, tactile, archival, and cohesive with the risograph travel-map assets.

**Decision:** keep `#EEDCC7` as the dominant landing-page field. It looks right for Sendero because it behaves like aged travel paper rather than beige UI chrome. The new postcard assets add enough blue water, olive land, black linework, and vermillion route marks to keep the page from becoming a one-note cream palette.

### 7. Color Usage Guidance

#### Default Hierarchy

1. **Vermillion** = main brand expression
2. **Midnight** = trusted/system expression
3. **Sea** = functional travel expression
4. **Sand** = warm editorial expression

#### Rule

The alternate colors support the system. They do **not** replace the primacy of vermillion.

### 8. Icon Usage

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

### 9. Clear Space

Always leave breathing room around the icon.

**Minimum clear space:** at least **25% of the icon's width** on all sides.

Do not crowd it with:

- text
- buttons
- borders
- other logos
- busy illustrations

The icon works best when it has room to sit calmly.

### 10. Minimum Size

#### Digital

- minimum: **24 px height**
- preferred: **64 px and above**

#### Print

- minimum: **12 mm height**

Below these sizes, texture may be reduced if necessary, but the shape must stay intact.

### 11. Construction Principles

The icon should preserve these elements:

- rounded binocular body
- balanced two-lens structure
- star in left lens
- mountain line in right lens
- single-color outline logic
- simple internal detail

Do not alter the internal symbols casually.

### 12. Do / Don't

#### Do

- use a single solid color
- keep proportions intact
- place on calm, high-contrast backgrounds
- preserve the mark exactly
- use it with restraint and confidence

#### Don't

- stretch or squash the icon
- add drop shadows
- add gradients
- put it on noisy backgrounds
- over-outline it
- rotate it arbitrarily
- replace the star or mountain with random symbols

### 13. Background Applications

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

### 14. Typography Direction

The typography should feel:

- editorial
- elegant
- legible
- slightly literary
- premium but not ornate

#### Best Fit

- serif for the main wordmark/headlines
- restrained supporting sans or simple serif for product/body use

The overall balance should feel like **travel magazine meets intelligent product company**.

### 15. Illustration Direction

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

### 16. Postcard Storytelling System

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

### 17. Brand Tone In Product

Sendero should look like it:

- understands travel deeply
- reduces chaos
- guides you with taste
- sees possibilities before you do

It should feel more like a **trusted editorial travel guide with intelligence** than a generic booking engine.

### 18. Positioning Summary

**Sendero is an intelligent travel brand built around guidance, perspective, and discovery.**

Its identity should feel warm, distinctive, editorial, and quietly capable.

The binocular icon is the clearest expression of this idea because it represents:

- looking ahead
- seeing clearly
- choosing better routes
- finding meaningful destinations

### 19. Quick Usage Cheat Sheet

**Primary icon color:** Vermillion `#D65438`
**Alt 1:** Midnight `#1F2A44`
**Alt 2:** Sea `#0F7C82`
**Alt 3:** Sand `#B6844E`

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

### 20. One-Line Internal Brand Rule

**Sendero should feel like an intelligent explorer's mark, not a generic travel app logo.**

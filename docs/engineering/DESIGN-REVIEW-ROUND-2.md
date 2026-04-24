# Design Review — Round 2

**Date:** 2026-04-23
**Skills applied:** `/impeccable`, `/design-review`, `/awwwards-animations`, `/emilkowalski/skill`
**Scope:** auth (app), hero (marketing), shared motion system (ui), plan for docs + help
**Status:** shipped round 2 — motion primitives, auth refinement, marketing hero first-load

---

## 0. What changed at the system level

We graduated motion from a per-route concern into a shared design primitive. All four apps
(`app`, `marketing`, `docs`, `help`) now inherit the same ease curves, duration tokens, and
utility classes from a single source — `@sendero/ui/motion.css`.

This is the Emil move: **motion is a system, not an afterthought.** You don't invent curves
per page. You pick them once, thoughtfully, and reuse them everywhere so the whole product
feels like one hand made it.

### Files shipped

| File | Purpose |
|---|---|
| `packages/ui/src/motion.css` | Shared ease curves, durations, utilities |
| `packages/ui/package.json` | Exports `./motion.css` |
| `packages/ui/src/globals.css` | Imports motion (covers `app` + `docs`) |
| `apps/marketing/app/globals.css` | Imports motion directly |
| `apps/help/app/globals.css` | Imports motion directly |
| `apps/app/components/auth-shell.tsx` | Emil-refactored to use primitives |
| `apps/marketing/app/page.tsx` | Hero uses `s-fade` + `s-enter` + `s-press` |

### The primitives (one source of truth)

```css
--s-ease-out:    cubic-bezier(0.22, 1, 0.36, 1);   /* Emil's go-to for entrances  */
--s-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* crossfades, reveals          */
--s-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);/* used rarely, for emphasis    */

--s-dur-fast: 140ms;   /* press, micro-feedback  */
--s-dur-base: 220ms;   /* hover, state swaps     */
--s-dur-slow: 360ms;   /* entrances, reveals     */

--s-reveal-y: 6px;     /* never further          */
```

Utilities shipped: `.s-press`, `.s-enter` (+ `.s-enter-1…5`), `.s-fade` (+ stagger),
`.s-reveal`, `.s-reveal-up`, `.s-draw`, `.s-pulse-dot`, `.s-vt-crossfade`.

All respect `prefers-reduced-motion`.

---

## 1. `AuthShell` — Emil refinement (Round 1 → Round 2)

Round 1 shipped the editorial print aesthetic: registration marks, animated rule, index
rows, dual vermillion hero images with masked diffusion.

Round 2 stripped the performative parts and made every animation justify its duration.

### Before / After

| Aspect | Round 1 (first pass) | Round 2 (Emil pass) | Why |
|---|---|---|---|
| **Masthead chrome** | `EDITION / 02 / DATELINE` block in the top-right | Removed — only logo + language selector remain | Sign-in ≠ newspaper. Protected surface, calm density. |
| **Right-pane footer** | `AUTH · PANEL` label | Removed | Same — no user value, pure decoration |
| **Entrance stagger** | 120ms base, 160ms step (5 slots = ~800ms) | 80ms base, 60ms step (~340ms total) | Emil: entrances should feel *already finished* by the time the user reaches for the form |
| **Form bloom** | `scale(0.97)` + `translateY(10px)` @ 640ms | `scale(0.985)` + `translateY(6px)` @ 420ms | Scale from 0.985 not 0.97. Never from 0. |
| **Index-row hover** | `width` transition on the left rule | `transform: scaleX(2)` on the rule | `width` triggers layout; `transform` composites on the GPU |
| **Image reveal** | Opacity + `translateY` | `clip-path: inset(... 100% ...)` sweeping top→bottom and bottom→top | Clip-path reveal is the Emil/Awwwards primitive for "it's drawing itself in" |
| **Active feedback** | None | `.s-press` on logo + language selector → `scale(0.97)` on `:active` | The single most-underrated Emil detail: buttons need to feel pressed |
| **Easing** | Mixed (`cubic-bezier(0.2, 0.8, 0.2, 1)` locally) | `var(--s-ease-out)`, `var(--s-ease-in-out)` from shared tokens | One curve system, not per-component taste |
| **Editorial rule + dot** | Stroke draws, then dot fades in | Kept — this one earned its keep | Signature element; directs the eye from title to body copy |
| **Index rule entrance** | `scaleY` top-down | `scaleX` with `transform-origin: top` | Small, but composites cleaner and matches hover axis |

### Net effect

The page loads faster to perceived-done. The form is where your eye lands within 500ms.
The editorial details (rule, registration marks, index numerals) are still there — they're
just not shouting.

### Rule of thumb we codified

> If an animation is longer than 420ms or further than 6px, it needs a written reason.

---

## 2. Marketing hero — cross-app inheritance proof

The point of round 2's motion system is that **the auth page and the marketing hero
now share the same entrance vocabulary**, set from one file.

### Before / After

| Layer | Before | After |
|---|---|---|
| Hero art (background imagery) | Static on load | `.s-fade .s-fade-1` — 440ms fade-in, `--s-ease-out` |
| Eyebrow | Static | `.s-enter .s-enter-1` — 80ms delay |
| Title | Static | `.s-enter .s-enter-2` — 140ms delay |
| Subtitle | Static | `.s-enter .s-enter-3` — 200ms delay |
| CTA row | Static | `.s-enter .s-enter-4` — 260ms delay |
| Primary/secondary CTA | Hover only | `.s-press` → active-state `scale(0.97)` |
| Nav waitlist + secondary | Hover only | `.s-press` |

Total entrance completes at ~620ms after hydration. Matches `AuthShell`'s ~640ms.
A user moving `marketing → app/sign-in` sees the same rhythm — not the same content, but
the same *choreography*. That's the system working.

### What we *didn't* touch

- No parallax, no scroll-linked effects in the hero. Emil: "don't animate what the user
  didn't ask for." The hero's job is to load fast, read clean, and get out of the way.
- No stagger-on-scroll for the waitlist or mosaic sections yet — that's round 3.

---

## 3. `/docs` and `/help` — motion is wired, aesthetic is next

Motion is already imported into both. That's the infrastructure done.

What's *not* done: neither app currently uses the primitives. Both are clean, readable
docs sites — but both could use a tiny Emil pass to feel like they belong to the same
company that shipped `AuthShell`.

### Docs (`apps/docs`) — planned next session

| Surface | Primitive to add | Why |
|---|---|---|
| Sidebar active link | `.s-press` + subtle background transition via `--s-dur-base` | Active state feedback is nonexistent |
| Page title block on route change | `.s-enter` on MDX `<h1>` via layout wrapper | Page-to-page transitions feel static |
| Code block copy button | `.s-press` + checkmark via `.s-vt-crossfade` | The single most-interacted element in docs |
| Sidebar section expand | Keep Fumadocs default, but retune transition-duration to `var(--s-dur-base)` | Consistency |

### Help (`apps/help`) — planned next session

| Surface | Primitive to add | Why |
|---|---|---|
| Article card hover | `transform: translateY(-2px)` + `s-press` | Currently flat hover; cards should feel liftable |
| Search input focus | Border `--s-dur-base` + subtle inset shadow | Input focus is invisible right now |
| Category pill active | `.s-press` | Taps should feel responsive |
| Article entrance | `.s-enter-1..3` on eyebrow / title / body | Matches the rest of the product |

---

## 4. Prioritized next-session plan

Ordered by "highest leverage on Awwwards-worthiness per minute of work":

1. **Marketing scroll choreography** (high impact)
   - Add `.s-reveal-up` with IntersectionObserver to waitlist title, mosaic rows,
     FAQ items. One observer, one primitive, applied globally.
   - This is the visible "wow" upgrade — the hero is calm, but the scroll should
     *reveal* the editorial layout section by section.
   - Keep reveals subtle: `6px` translate, `360ms`, `var(--s-ease-out)`, no stagger
     longer than 4 slots per viewport.

2. **Docs sidebar + code-block polish** (high usage, medium effort)
   - Start with the copy-code button crossfade. Most-touched element; biggest
     perceived quality lift per pixel changed.

3. **Help search + category nav** (medium impact)
   - Focus ring, press feedback, article card lift.

4. **Page transitions (all apps)** (high effort, big payoff — do last)
   - Next.js `unstable_ViewTransition` + `.s-vt-crossfade` between protected-app
     routes. Fallback to `.s-enter` on route params.
   - This is the "they're using View Transitions well" moment Awwwards jurors notice.

5. **Cursor / magnetic CTA** (only if brand-aligned — probably skip)
   - The brand is editorial/print. Custom cursors fight that. We deliberately
     *don't* need this.

---

## 5. What makes this Awwwards-contender vs. "nice site"

Three things, all Emil principles, all verifiable:

1. **One motion system, four apps.** Jurors read consistency as craft.
2. **Every animation is sub-420ms and sub-6px.** No 1-second hero text reveals.
   No parallax. No scroll-jacking. Calm, fast, purposeful.
3. **Active states exist.** `.s-press` is the detail most AI-generated sites forget.
   A button that doesn't compress on tap looks broken even when you can't name why.

---

## 6. Acceptance criteria for Round 3

Before shipping round 3, each of these must be true:

- [ ] Marketing scroll: waitlist, mosaic, FAQ all reveal on intersection with `.s-reveal-up`
- [ ] Docs: copy-code button uses `.s-vt-crossfade`; sidebar active uses `.s-press`
- [ ] Help: search focus, category pills, and article cards use primitives
- [ ] View Transitions prototype on one route pair (`/` → `/sign-in` or similar)
- [ ] `grep -R "cubic-bezier" apps/` returns zero hits (all easing via `var(--s-ease-*)`)
- [ ] `grep -R "animation-duration: [5-9][0-9][0-9]" apps/` returns zero hits >420ms
- [ ] Lighthouse a11y ≥95 on every touched page
- [ ] `prefers-reduced-motion: reduce` disables every entrance (not just dampens)

---

## Appendix — file map after round 2

```
packages/ui/src/
  motion.css                      ← new, source of truth
  globals.css                     ← imports motion.css
  package.json                    ← exports ./motion.css

apps/app/components/
  auth-shell.tsx                  ← refactored onto primitives

apps/marketing/app/
  globals.css                     ← imports @sendero/ui/motion.css
  page.tsx                        ← hero uses s-fade + s-enter + s-press

apps/docs/                        ← inherits via ui/globals.css (no change needed)
apps/help/app/
  globals.css                     ← imports @sendero/ui/motion.css (ready)
```

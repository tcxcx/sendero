# @sendero/storybook

Sendero's design system showcase. Storybook 8 on the Vite builder, rendering every UI primitive and composed piece against the live vermilion tokens from `app/globals.css`.

## Run it

```bash
bun install                        # from the repo root
bun --cwd apps/storybook dev       # http://localhost:3030
```

## Structure

```
apps/storybook/
├── .storybook/
│   ├── main.ts                    # builder config + Vite aliases
│   ├── preview.ts                 # loads globals.css, theme toggle
│   ├── preview-head.html          # Geist Sans + Geist Mono
│   └── storybook-shell.css
├── stories/
│   ├── tokens/                    # Colors, Typography
│   ├── primitives/                # Button, Badge, Tag
│   ├── composed/                  # FooterRail, NanopayFeed
│   └── brand/                     # Selection
├── package.json
└── tsconfig.json
```

## Decision doc

### When does a component move to `packages/ui`?

**Stay in `apps/app/components/`** when:
- It depends on app-specific hooks (zustand store, `useSendero`, `useMeter`).
- It's a single-use page composition (`Hero`, `Stage`, `ChatCol`).
- Its contract is still moving fast.

**Promote to `packages/ui`** when at least two of these are true:
- A second surface needs it — `apps/docs`, `apps/storybook`, a partner-hosted iframe.
- Its props surface has been stable for two+ sprints.
- It has no side effects beyond rendering + fire-and-forget callbacks.

Current candidates for extraction: `Button`, `Badge`, `Tag` (already rewritten inline in this package; copy them to `packages/ui/src/*` when you extract). `FooterRail` stays in the app until we have a reason to render it somewhere else — Storybook imports it by path reference rather than duplicating.

### How stories find Sendero CSS tokens

`.storybook/preview.ts` imports `../../../app/globals.css` directly. Every story inherits the full `--ink` / `--bg` / `--accent-*` vocabulary without Storybook needing to know the brand exists. Change the vermilion hex in one place; every swatch, button, and composed rail updates.

### How to preview dark mode

The toolbar's theme toggle (powered by `@storybook/addon-themes`) flips `.dark` on `<html>`. This matches the class the shipping app toggles, so the same dark-mode CSS in `globals.css` applies verbatim.

### Chromatic / visual regression

Not wired up in this scaffold — intentionally deferred. When we're ready:

1. `bunx chromatic --project-token=$CHROMATIC_PROJECT_TOKEN` after `storybook build`.
2. Add `CHROMATIC_PROJECT_TOKEN` to Vercel + GitHub Actions secrets.
3. Add a `.github/workflows/chromatic.yml` that runs on PR and publishes the static build.

Alternative: deploy `storybook-static/` to Vercel as a sibling project. `vercel --prod apps/storybook/storybook-static` from CI, then link the preview URL in PR descriptions.

### Env vars

- `CHROMATIC_PROJECT_TOKEN` — **deferred**, only needed when visual regression lands.
- `NEXT_PUBLIC_SENDERO_EDGE_URL` — read by `@components/use-meter` if a story imports it. The `NanopayFeed` story uses fixtures and does not read this.

### Known limitations

- `FooterRail` reaches into the zustand store — the story seeds state via `useSendero.setState` in a layout effect. This is pragmatic, not elegant. When `FooterRail` is promoted to `packages/ui` it should accept props rather than read the store.
- `NanopayFeed` in this scaffold is a standalone presentational component built for isolation. The production integration lives in `apps/app/components/workflow-log.tsx`; Storybook's version is what should land in `packages/ui` once the shape stabilises.

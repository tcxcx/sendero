# @sendero/docs

Public developer docs for the Sendero travel API — built with [Fumadocs](https://fumadocs.vercel.app) on Next.js 15, served from `docs.sendero.travel`.

## Run it

```bash
bun install         # from the repo root
bun --cwd apps/docs dev    # dev server on :3020
```

First run will execute `fumadocs-mdx` via the `postinstall` hook — this builds the `.source` types the docs site reads from.

## Structure

```
apps/docs/
├── app/
│   ├── layout.tsx                  # fonts, RootProvider, brand tokens
│   ├── page.tsx                    # editorial landing
│   └── docs/
│       ├── layout.tsx              # sidebar + nav shell
│       └── [[...slug]]/page.tsx    # MDX renderer
├── content/docs/
│   ├── meta.json                   # sidebar order
│   ├── index.mdx                   # welcome
│   ├── quickstart.mdx
│   ├── agent-to-agent-booking.mdx
│   ├── tools/
│   │   ├── overview.mdx            # public tool + workflow table
│   │   ├── search_flights.mdx
│   │   └── settle_split.mdx
│   ├── x402-nanopayments.mdx
│   ├── mcp-integration.mdx
│   └── pricing.mdx
├── lib/source.ts                   # fumadocs source loader
├── next.config.mjs
├── source.config.ts
└── tsconfig.json
```

## Keeping tool docs in sync with the registry

Today the per-tool MDX (`content/docs/tools/*.mdx`) is authored by hand. The source of truth for public tools is `packages/tools/src/*.ts` — each file exports a `ToolDef` with `name`, `description`, input JSON schema, and output schema. The source of truth for multi-step plans is `packages/workflows/src/catalog.ts`.

**Next step (post-hackathon):**

1. Add `scripts/generate-tool-docs.ts` that imports `toolList` from `@sendero/tools` and writes one MDX file per tool into `content/docs/tools/_generated/`.
2. Render the input/output JSON schemas with `fumadocs-typescript` so the tables in each page are auto-built.
3. Wire the script into `turbo.json` as a `predev` / `prebuild` task so the docs can never go stale against the registry.

Until that lands, any change to a tool's schema in `packages/tools` requires a manual edit to the matching MDX file.

## Brand tokens

The docs site reuses `../../app/globals.css` directly rather than duplicating the vermilion palette. The remap from Sendero tokens (`--ink`, `--bg`) to Fumadocs tokens (`--fd-primary`, `--fd-background`) lives in `app/docs-overrides.css`.

## Env vars

No build-time env vars are required. At runtime the docs site displays the public `SENDERO_EDGE_URL` (`https://edge.sendero.travel`) in curl examples — if you want example URLs to point at a preview edge, set:

```bash
NEXT_PUBLIC_SENDERO_EDGE_URL=https://preview.edge.sendero.travel
```

The landing page does not currently read this; the quickstart examples use shell env vars directly.

## Production deploys — rolling releases

Config: [`.rolling-release.json`](./.rolling-release.json).

| Stage | Traffic | Bake time |
|---|---|---|
| 1 | 25% | 15 min |
| 2 | 100% | — |

Two-stage rollout — the docs site is read-mostly so a long bake doesn't pay off, but a quarter-traffic stage still catches the catastrophic-render case.

**Deploy:**

```bash
bun run deploy:docs                  # from repo root
bun run deploy:rolling:status:docs
bun run deploy:rolling:abort:docs    # if the canary breaks
```

See the root [README.md](../../README.md#rolling-releases-on-vercel--gradual-production-rollouts) for the full rolling-releases playbook.

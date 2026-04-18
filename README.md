# Pasillo × Arc

**An AI travel agent that books and settles itself.**

B2B2C travel platform for the **Circle Arc hackathon** — partners plug in their corporate traveler base; every flight, hotel, and ground leg is booked by an AI workflow and settled on Arc L2 in USDC or EURC.

> This app is intentionally **standalone** inside the monorepo so it can be extracted to its own repo for submission. Zero `@bu/*` workspace imports.

## Running

```bash
cd apps/pasillo-arc
bun install     # or npm/pnpm/yarn
bun run dev     # → http://localhost:3010
```

## Stack

- **Next.js 15** (App Router, Turbopack)
- **React 19**
- **Geist Sans / Geist Mono / Departure Mono** — Cobe-inspired typography
- **Pure SVG Fibonacci globe** — no WebGL / CDN dependencies

## Layout

```
  ┌───────────────────────────────────────────────────────┐
  │ Topbar · Partner breadcrumb · tier · version          │
  ├───────────────────────────────────────────────────────┤
  │ Subbar · Traveler · Scenario chip · Status pills      │
  ├────────────┬───────────────────────────┬──────────────┤
  │            │                           │              │
  │   Chat     │   Stage                   │   Workflow   │
  │   column   │   itinerary · hotels      │   log        │
  │   (left)   │   ground · policy         │   (right)    │
  │            │   approvals · settlement  │              │
  │            │                           │              │
  ├────────────┴───────────────────────────┴──────────────┤
  │ Footer rail · block height · treasury · memo          │
  └───────────────────────────────────────────────────────┘
```

## Scenarios (6)

1. **Business Trip** — SFO → LHR → BER → SFO
2. **Conference · Paris** — BOS → CDG, VivaTech
3. **Team Offsite · Lisbon** — 12 travelers, multi-origin
4. **Emergency Rebook** — same-day DXB → SIN
5. **Contractor Fly-in** — EZE → BOS, USDC payroll
6. **Student Cohort · Rome** — 30 travelers, academic block

## Tweaks (bottom-right panel)

- Settlement token: USDC / EURC / Auto-FX
- Agent verbosity: Terse / Normal / Verbose
- Scenario picker
- Globe hero on/off
- Light / Dark theme

## Arc × Circle integration

Every scenario shows a per-invoice breakdown settled via **Circle CCTP v2 on Arc L2**:

- Mixed USDC / EURC payouts per vendor
- Arc block number + tx hash + memo
- Sub-6s finality target
- Treasury balance in both tokens

## File structure

```
apps/pasillo-arc/
├── app/
│   ├── layout.tsx          # Root layout, font loading
│   ├── page.tsx            # Mounts <PasilloApp />
│   └── globals.css         # Full Cobe-inspired stylesheet
├── components/
│   ├── pasillo-app.tsx     # Root client component
│   ├── scenarios.ts        # 6 scenario data records
│   ├── ui.tsx              # Topbar, Subbar, ChatCol, Stage cards, WorkflowLog, FooterRail
│   ├── globe.tsx           # Interactive SVG Fibonacci globe
│   └── tweaks.tsx          # Settings panel
├── package.json
├── next.config.mjs
├── tsconfig.json
└── README.md
```

## Extraction to standalone repo

```bash
cp -r apps/pasillo-arc /tmp/pasillo-arc
cd /tmp/pasillo-arc
git init && gh repo create pasillo-arc --private --source .
```

No workspace deps — nothing to rewrite.

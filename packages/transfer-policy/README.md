# `@sendero/transfer-policy`

> The safety kernel that sits between an AI agent and your treasury.
> Composable `PolicyGuard` chains. Mathematical guarantees against
> runaway spending. Same API for x402 micro-charges, traveler DCW
> spends, and tenant Modular Wallet payouts.

---

## Why this package exists

Give an AI agent a private key and a hallucination, prompt-injection,
or simple logic bug can drain a treasury in seconds. Most blockchain
SDKs are designed for a human with a screen and a confirm button.
Agents have neither.

`@sendero/transfer-policy` is a kernel of small composable guards
that every payment in Sendero passes through. Each guard is async,
zero-dependency, and policy-only — your store layer (Prisma, Redis,
in-memory) supplies the data.

Three outcomes per payment:

| Outcome                                  | Meaning                                |
| ---------------------------------------- | -------------------------------------- |
| `allowed: true`                          | Proceed.                               |
| `allowed: false`                         | Hard block. Reason in `result.reason`. |
| `allowed: true, requiresApproval: true`  | Pause for human approval.              |

That's it. One method. Any payment kind. Safety atomic.

---

## The guards

| Guard            | What it enforces                                                    |
| ---------------- | ------------------------------------------------------------------- |
| `BudgetGuard`    | Daily / weekly / monthly USD ceiling. Hard or soft.                 |
| `SingleTxGuard`  | Per-transaction maximum.                                            |
| `RecipientGuard` | Allow / deny address lists. Case-insensitive.                       |
| `RateLimitGuard` | N transactions per trailing window.                                 |
| `ConfirmGuard`   | Pause for operator approval, optional value threshold.              |

Each scoped to `tenant`, `traveler`, or `tool` — pick one per guard.

---

## Quick start

```typescript
import {
  PolicyChain,
  BudgetGuard,
  SingleTxGuard,
  ConfirmGuard,
} from '@sendero/transfer-policy';

const chain = new PolicyChain([
  new SingleTxGuard({ maxMicroUsdc: 5_000_000n }),     // $5
  new BudgetGuard({
    period: 'daily',
    capMicroUsdc: 50_000_000n,                         // $50/day
    hardCap: true,
    scope: 'tenant',
    store: budgetStore,                                // your Prisma adapter
  }),
  new ConfirmGuard({ triggerAtMicroUsdc: 1_000_000_000n }), // approval ≥ $1k
]);

const result = await chain.check({
  tenantId: 'tnt_acme',
  amountMicroUsdc: 250_000n,
  kind: 'x402',
  toolName: 'duffel.search',
});

if (!result.allowed) throw new BlockedByPolicy(result.reason);
if (result.requiresApproval) await pauseForOperator(result);
else await proceed();
```

That's the whole API. The guard chain is a `for` loop with three exit
conditions. No magic.

---

## Two wallet models, one policy chain

Sendero's payment surface splits two ways depending on who's spending.
The same `PolicyChain` guards both.

### Travelers — Developer-Controlled Wallets on Circle Gateway

Travelers hold [Developer-Controlled Wallets](https://developers.circle.com/w3s/developer-controlled-wallets)
issued by Sendero. They flow into [Circle App Kit's Unified Balance
Kit](https://developers.circle.com/app-kit/unified-balance), which
combines USDC from any chain — Base, Arbitrum, Solana, Arc — into
one chain-agnostic spendable balance backed by [Circle Gateway](https://developers.circle.com/gateway).

The agent calls `kit.unifiedBalance.spend({ amount, from, to })` and
App Kit picks the source chains automatically. We wrap that one call
in a `PolicyChain` so a runaway agent can't drain the unified pool:

```typescript
const policy = await loadTravelerPolicies(travelerId);   // your store
const decision = await policy.check({
  tenantId, travelerId,
  amountMicroUsdc, kind: 'transfer',
  recipient: spendArgs.to.recipientAddress,
});
if (!decision.allowed) throw new Error(decision.reason);

const result = await kit.unifiedBalance.spend(spendArgs);
```

Why this combination is special:

- **One balance across every chain** — no manual CCTP routing, no
  per-chain reserves to top up, no "wrong-chain" failure modes.
- **Sendero owns the policy** — operators set per-traveler caps,
  recipient allowlists, approval thresholds in the dashboard.
- **Atomic enforcement** — every `spend` runs through the chain
  before it touches Gateway. The spend can't fire if any guard
  blocks.
- **Delegate flow** — Sendero's backend can act as a delegate that
  signs spends on the traveler's behalf via App Kit's
  [delegate quickstart](https://developers.circle.com/app-kit/quickstarts/unified-balance-delegate-deposit-and-spend),
  and our policy chain still gates the spend before it goes out.

This package is the ergonomic safety layer on top of Circle App Kit's
new Unified Balance Kit. The combination is what makes autonomous
multichain agent spending actually safe to ship.

### Tenants — Modular Wallets on Arc

Tenant treasuries are [Circle Modular Wallets](https://developers.circle.com/w3s/modular-wallets)
on Arc. Modular Wallets aren't Gateway-backed, so the unified-balance
flow doesn't apply — tenants spend directly on Arc and bridge through
CCTP when they need to. The policy chain is identical:

```typescript
const policy = await loadTenantPolicies(tenantId);
const decision = await policy.check({
  tenantId,
  amountMicroUsdc,
  kind: 'payout',
  recipient: payee,
});
if (!decision.allowed) throw new Error(decision.reason);

await modularWallet.send({ to: payee, amount });
```

One chain abstracts both wallet models. Same `PaymentContext`. Same
guards. Same UI in the Caps editor.

---

## How the chain composes

```
PolicyChain([SingleTx, Budget, Confirm])
  ├─ SingleTx checks amount → allowed
  ├─ Budget reads window spend → allowed (within ceiling)
  └─ Confirm sees amount ≥ threshold → allowed, requiresApproval
       └─ chain returns { allowed: true, requiresApproval: true }
```

- Hard rejection short-circuits — guards after the blocker don't run.
- `requiresApproval` propagates through subsequent allows.
- A reject after an approval still wins (budget block beats pending
  review — the agent finds out it can't spend, and there's nothing
  for the human to approve).
- Every result carries a `trace[]` so the dashboard can show the
  operator exactly which guard fired.

---

## Stores: bring your own data layer

The package has zero runtime deps. Each guard exposes a small async
interface — your app implements it against Prisma, Redis, KV, or an
in-memory cache.

```typescript
import type { BudgetStore } from '@sendero/transfer-policy';

const prismaBudgetStore: BudgetStore = {
  async spentInWindow({ tenantId, travelerId, toolName, windowStartedAt }) {
    const agg = await prisma.meterEvent.aggregate({
      where: {
        tenantId,
        ...(travelerId ? { travelerId } : {}),
        ...(toolName ? { toolName } : {}),
        status: 'paid',
        at: { gte: windowStartedAt },
      },
      _sum: { priceMicroUsdc: true },
    });
    return agg._sum.priceMicroUsdc ?? 0n;
  },
};
```

Same shape for `RateLimitStore`. `RecipientGuard`, `SingleTxGuard`,
and `ConfirmGuard` are pure — no store required.

---

## Tests

```bash
cd packages/transfer-policy && bun test
# 32 pass / 0 fail / 65 expect() calls
```

Per-guard suites cover allow / block / edge cases. Chain suite covers
empty chain, short-circuit, approval propagation, and reject-after-
approval ordering.

---

## How it fits into the Sendero monorepo

| Surface                              | What runs                                                         |
| ------------------------------------ | ----------------------------------------------------------------- |
| `/api/agent/dispatch` (x402)         | Cap preflight via `BudgetGuard(scope: 'tenant')`.                 |
| `/api/agent/dispatch` (per-tool)     | `BudgetGuard(scope: 'tool')` + `RateLimitGuard(scope: 'tool')`.   |
| Traveler DCW Gateway spend           | `PolicyChain` runs before `kit.unifiedBalance.spend()`.           |
| Tenant Modular Wallet payout         | Same chain runs before `modularWallet.send()`.                    |
| `/dashboard/caps`                    | Shows the active guards, their windows, and live consumption.    |

Caps editor at `/dashboard/caps/new` writes the policy rows; the
runtime loads them and composes the chain at request time.

---

## Roadmap

- **DCW traveler-policy editor** in `/dashboard/passport/[id]/policy`
  (per-traveler scope, recipient allow lists from address book).
- **Time-of-day guard** for booking windows (operators sleep, agents
  don't).
- **Velocity guard** combining BudgetGuard + RateLimitGuard with a
  shared backoff signal.
- **On-chain attestation** — emit a guard-pass event so settlement
  contracts can verify a spend cleared policy off-chain before
  trusting the burn intent.

---

## Inspiration & references

- [Circle App Kit · Unified Balance](https://developers.circle.com/app-kit/unified-balance)
  — chain-agnostic USDC balance backed by Gateway.
- [Circle Gateway](https://developers.circle.com/gateway) — the
  protocol underneath Unified Balance.
- [Circle Developer-Controlled Wallets](https://developers.circle.com/w3s/developer-controlled-wallets)
  — traveler wallet model.
- [Circle Modular Wallets](https://developers.circle.com/w3s/modular-wallets)
  — tenant treasury model.
- [Cross-Chain Transfer Protocol (CCTP)](https://developers.circle.com/cctp)
  — the cross-chain primitive Modular Wallets use directly when
  spending across chains.

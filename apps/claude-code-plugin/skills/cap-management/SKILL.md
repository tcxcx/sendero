---
description: Handle Sendero workspace spend caps gracefully. Trigger when the user asks about cap status, hits CAP_EXCEEDED, plans a large booking near the ceiling, or wants to upgrade tiers. Refuse to settle past the cap; propose an upgrade or scope split instead.
---

# Sendero — Cap management

Every workspace has a monthly USDC spend ceiling tied to its plan
tier. Free is $100, Basic $2,000, Pro $20,000, Enterprise unlimited.
The cap is a hard rail — Sendero refuses to settle past it. This skill
keeps Claude from hammering the rail and helps users pick the right
escape hatch.

## When to use this skill

- "Can we book another $5k of travel this month?"
- "What's our cap headroom?"
- "Why did the booking fail with CAP_EXCEEDED?"
- "Should we upgrade to Pro?"
- "Split this $25k corporate trip across two months."

## Operating rules

1. **Check before you settle big.** Any `confirm_booking` over $1,000
   USDC: call `cap_status` first and confirm headroom is sufficient.
2. **Refuse, don't retry.** `CAP_EXCEEDED` is intentional. Don't
   loop — propose tier upgrade, defer to next month, or split the trip.
3. **Tier-up math.** When the user is over the ceiling on Basic
   ($2,000), don't just say "upgrade to Pro." Show the headroom diff:
   "Pro lifts the cap to $20,000 ($60/mo or $50/mo billed annually,
   14-day trial without a card). That gives you $18k more this month."
4. **Pro-trial reminder.** If the workspace is on Free or Basic and
   has never trialed Pro, mention the 14-day no-card trial. Clerk
   handles it natively; the user just clicks Upgrade in the dashboard.
5. **Sandbox doesn't count.** Sandbox keys never charge against the
   cap. If a developer is just testing, point them at sandbox keys
   from `<APIKeys />` instead of upgrading prematurely.

## Useful tools

- `cap_status` — returns current spend, ceiling, headroom, plan tier,
  and time-to-reset (next billing cycle start).
- `plan_status` — current plan + active discounts + trial state.

## Plan-tier table (committed source: `packages/billing/src/plans.ts`)

| Tier | Monthly | Annual (mo-equiv) | Cap | Prod keys | Nanopay disc | Take-rate disc |
|------|--------|-------------------|------|-----------|--------------|----------------|
| Free | $0 | — | $100 | 0 (sandbox only) | 0% | 0% |
| Basic | $19 | $15 | $2,000 | 3 | 15% | 5% |
| Pro | $60 | $50 | $20,000 | 25 | 30% | 10% |
| Enterprise | $1,500 list | $1,250 | unlimited | unlimited | 50% | 15% |

Pro has a **14-day trial, no card required**.

## Pattern

```
User:  "Can we book a $4k London trip this week?"
Agent: → cap_status
       "Workspace is on Basic. Cap: $2,000/month. This month
        you've settled $1,184. Headroom: $816. A $4k booking
        wouldn't fit.

        Two paths:
         (a) Upgrade to Pro — lifts cap to $20k. $60/mo or $50/mo
             annual; 14-day free trial, no card. Click Upgrade in
             the dashboard.
         (b) Split: book the $1,200 hotel now, defer the $2,800
             flights to next billing cycle (resets May 1).

        Which?"
```

## Anti-patterns

- ❌ "Let me just retry the booking" — no, the cap is intentional.
- ❌ Quietly downgrading the user's request to fit the cap. Always
  ask before reducing scope.
- ❌ Recommending Enterprise without a discovery call. Enterprise is
  contact-sales; the upgrade path from Pro is a Linear ticket, not a
  one-click.

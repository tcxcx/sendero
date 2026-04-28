---
description: Use Sendero's ERC-8004 agent-identity tools to register agents and identities on-chain. Trigger when the user wants a verifiable agent ID, an auditor asks "who ran this turn", or the user is integrating a partner agent that needs an identity to settle on Arc.
---

# Sendero — Agent identity (ERC-8004)

ERC-8004 is the on-chain agent-identity standard Sendero uses to
attach a verifiable identity to every meter event. Auditors,
counterparties, and downstream tools can prove which agent (yours,
ours, or a partner's) ran a given tool call. This skill covers
register / look-up / dispute flows.

## When to use this skill

- "Register our agent on Arc."
- "Who's the on-chain identity for the agent that booked tr_4d9?"
- "Mint an identity for our partner so they can settle through us."
- "Dispute the agent claim on this settlement."

## The two registries

Sendero ships ERC-8004 in two halves on Arc:

- **Agent registry** — keyed on `tenantId + agent_slug`. Stores the
  agent's public key, capability tags, and the Sendero plan tier
  the agent runs against.
- **Identity registry** — keyed on `tenantId + user_id`. Stores the
  human or service account that initiated the action, distinct from
  the agent that executed it.

Together: an audit row says "user `u_123` requested tool `confirm_booking`
via agent `acme/concierge` at block 412,839,221." Both ids are
on-chain, both signed.

## Tools

- `register_agent({ slug, capabilities, publicKey })` — first-time
  agent mint. Returns the on-chain agent id.
- `register_identity({ userId, displayName, publicKey })` — first-
  time human identity mint.
- `get_agent(agentId)` / `get_identity(identityId)` — read-only
  lookups; cached server-side.
- `link_agent_to_settlement(agentId, settlementId)` — explicit
  attribution if the auto-link wasn't recorded (rare; usually only
  when a partner agent calls Sendero from outside our dispatch).
- `dispute_agent_claim(settlementId, reason)` — flag a settlement's
  claimed agent identity for review. Doesn't auto-reverse anything;
  opens a Linear ticket with the on-chain evidence attached.

## Operating rules

1. **One identity per workspace seat.** Don't mint a new identity for
   every booking. Look up the existing one (`get_identity_by_user`)
   and reuse.
2. **Public keys come from Circle Wallets.** Agent identity public
   keys are the same Arc wallet keys Sendero already mints per
   workspace. Don't generate fresh keypairs out-of-band.
3. **Capabilities matter.** `register_agent` takes a capability
   array (`["search", "hold", "confirm", "settle"]`). Auditors check
   this list — never grant more than the agent actually uses.
4. **Dispute is heavyweight.** Only `dispute_agent_claim` when you
   have on-chain evidence the agent identity claimed on a settlement
   doesn't match the actual caller. Open a ticket; don't auto-resolve.
5. **Sandbox identities don't count.** If the workspace is on a
   sandbox key, the registry calls return mock ids. The Linear ticket
   for production cutover should include "mint real ERC-8004 ids on
   Arc-Mainnet" as a step.

## Pattern

```
User:  "Register our concierge agent so partner platforms can verify it."
Agent: → get_agent_by_slug("acme/concierge")
       "No agent registered yet. Capabilities? Common set:
         - search (read-only inventory)
         - hold (place 24h holds)
         - confirm (settle bookings)
         - settle (commission settlement)
        Which apply to this agent?"
User:  "search and hold only — finance team handles confirm."
Agent: → register_agent({ slug: "acme/concierge",
                          capabilities: ["search","hold"],
                          publicKey: "<workspace arc wallet pubkey>" })
       "Registered. Agent id: agt_8f2 on Arc-Testnet block 412,840,991.
        Arcscan: arcscan.io/tx/0x9e…77c. Future settlements that
        originate from this agent will pin agt_8f2 to the audit row.

        When you're ready for confirm/settle, re-call register_agent
        with the expanded capabilities."
```

## Why this matters

- **For finance:** lets auditors filter the audit log by agent and
  verify capability bounds.
- **For partners:** a partner who books through Sendero with their own
  agent identity gets a clean attribution trail; their downstream
  customers can verify which agent ran the booking.
- **For dispute resolution:** if a settlement looks anomalous, the
  on-chain agent + identity gives a fast path to root cause.

## Anti-patterns

- ❌ Minting one identity per trip. Identities are stable across
  trips; the trip ledger is what changes.
- ❌ Adding `["*"]` to capabilities. ERC-8004 readers will reject
  it; auditors will flag it.
- ❌ Treating `dispute_agent_claim` as a button to push when something
  looks wrong. It's an escalation; have evidence.

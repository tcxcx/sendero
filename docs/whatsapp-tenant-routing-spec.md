# WhatsApp tenant routing — Phase 1 spec

**Status:** ready to implement (Phase 0 patches landed; this is the proper fix)
**Owner of code:** Codex
**Owner of UX polish + copywriting:** Claude (post-implementation)
**Branch hint:** `feat/wa-dynamic-tenant-routing` off `main`

---

## 0. Context

The shared sandbox WhatsApp number (`597907523413541`, +56 9 2040 3095) is installed across many tenants — every agency that runs a Sendero demo creates a `WhatsAppInstall` row pointing at the same `phoneNumberId`. Before Phase 0, the inbound routing did `prisma.whatsAppInstall.findFirst({ where: { phoneNumberId } })` and picked an arbitrary tenant. When that tenant got deleted or renamed, every conversation broke with "agency removed".

**Phase 0 (already shipped)** unified all callers behind `resolveTenantForWhatsAppTurn()` in `apps/app/lib/whatsapp-tenant-resolver.ts` with this priority chain:

1. Single-install tenant
2. Returning traveler's most-recent `ChannelIdentity` in the candidate set
3. Trusted-caller `body.tenantId` (verified live)
4. Last-known `ChannelIdentity` for the traveler in any tenant
5. Protected sandbox tenant (`metadata.protected: true`)
6. `WHATSAPP_DEFAULT_TENANT_ID` env-var

Phase 0 left two problems:

- **Kapso still sends a static `SENDERO_TENANT_ID`.** The resolver tolerates this when the tenant exists, but the env var remains a manual config that drifts. It should not be the primary signal.
- **Kapso never forwards `tenantPhoneNumberId`.** The resolver's priority chain only uses it when the `/api/tools/[name]` body carries it. Currently no caller passes it, so the routing falls back to traveler-binding heuristics instead of authoritative install lookups.

Phase 1 closes both gaps end-to-end.

---

## 1. Scope

| PR  | Title                                          | Goal                                                                                                                |
|-----|------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| PR-1 | Kapso forwards `tenantPhoneNumberId` + drops static env reliance | `sendero-tool-call` reads the bot phoneNumberId from Kapso `flow_info` and forwards it. `SENDERO_TENANT_ID` becomes optional. |
| PR-2 | Switch-agency UX                              | A traveler bound to multiple tenants can flip context with `@switch <slug>` or a quick-reply card. ChannelIdentity touch updates routing.   |
| PR-3 | Operator guard against protected-tenant delete | Admin tenant-delete route refuses `metadata.protected === true`. Same guard on Prisma Studio is documented, not enforced.                 |

PRs are independently mergeable. PR-1 alone removes the env-var fragility.

## 2. Non-goals

- **Don't redesign `WhatsAppInstall`.** The current schema (`tenantId @unique`, `@@unique([tenantId, phoneNumberId])`) is correct.
- **Don't auto-prompt unbound travelers to pick an agency on first message.** Sandbox fallback is the cold-start. Switch flow is opt-in (PR-2).
- **Don't change `/api/agent/dispatch` semantics.** Web operator chat doesn't need this routing; it already resolves tenant via Clerk session.
- **Don't move tenant resolution into Kapso.** Sendero stays the canonical resolver; Kapso just forwards facts.

---

## 3. Cross-cutting requirements

1. **Resolver is authoritative.** Every Sendero entrypoint that accepts a Kapso-forwarded tenant signal (`/api/tools/[name]`, `/api/agent/dispatch` shared-secret path, `/api/webhooks/whatsapp`) MUST run through `resolveTenantForWhatsAppTurn` and MUST NOT trust `body.tenantId` blindly. Phase 0 already wired this for the tools route + webhook; PR-1 must keep both call sites passing the new `tenantPhoneNumberId` through.
2. **Fail closed when the resolver returns `null`.** `/api/tools/[name]` already returns `400 tenant_unresolved`. Dispatch should match.
3. **Sandbox tenant is the floor.** Never resolve a turn against a deleted tenant. The resolver's `tenantExists()` checks guarantee this; do not weaken them.
4. **No new external integrations.** This is plumbing.
5. **No schema migrations in PR-1.** PR-2 may add one `User.activeTenantId` column or a `ChannelIdentityPin` table if needed, but keep the surface area small — prefer reusing `ChannelIdentity.updatedAt` ordering.

---

## 4. PR-1 — Kapso forwards `tenantPhoneNumberId`

### 4.1 Goal

`kapso/sendero-tenant-travel-agent/functions/sendero-tool-call/index.js` should:

- Read the bot's phoneNumberId from the Kapso `flow_info` block on every tool call.
- Forward it to Sendero as `tenantPhoneNumberId`.
- Keep `SENDERO_TENANT_ID` as an optional fallback only.

### 4.2 Files to change

**Modify (Kapso side):**
- `kapso/sendero-tenant-travel-agent/functions/sendero-tool-call/index.js`
- `kapso/sendero-tenant-travel-agent/functions/sendero-tool-call/function.yaml` (no new envs required; just remove `SENDERO_TENANT_ID` from the required-env doc)
- `kapso/sendero-tenant-travel-agent/scripts/sync-secrets.js` (drop `SENDERO_TENANT_ID` from the synced list if it lives there)
- README / docs referencing `SENDERO_TENANT_ID` to mark it deprecated

**No change needed (Sendero side):** Phase 0 already added `tenantPhoneNumberId` to `ToolBody` and routed it through `resolveTenantForWhatsAppTurn`. PR-1 just starts populating the field.

### 4.3 `flow_info` shape

Kapso's `agent_tool_called` event wraps the request as:

```js
raw = {
  input: {
    toolName: 'traveler_balance',
    input: { /* tool input */ },
    travelerPhone: '+593980668984',
    /* …possibly other forwarded fields */
  },
  flow_info: {
    business_phone_number_id: '597907523413541',  // ← target field
    customer_phone_number: '+593980668984',
    flow_execution_id: '5f8fd9c7-…',
    project_id: '6fb90673-…',
    /* … */
  }
};
```

Verify the exact field name with a single live call against the Kapso dev project (`KAPSO_API_BASE_URL=https://api.kapso.ai`); the field has been named `business_phone_number_id` in the Meta-mirroring payload but Kapso may pass it as `phone_number_id` or `tenant_phone_number_id`. Don't guess.

### 4.4 Function changes

```js
// Inside the POST handler in sendero-tool-call/index.js, after `body` is set:
const flowInfo = (raw && typeof raw === 'object' && raw.flow_info && typeof raw.flow_info === 'object')
  ? raw.flow_info
  : null;

const tenantPhoneNumberId =
  (flowInfo && (flowInfo.business_phone_number_id || flowInfo.phone_number_id)) || null;

const forwardBody = {
  input: body.input ?? {},
  ...(body.channelIdentityId ? { channelIdentityId: body.channelIdentityId } : {}),
  ...(body.travelerPhone ? { travelerPhone: body.travelerPhone } : {}),
  ...(body.tripId ? { tripId: body.tripId } : {}),
  ...(tenantPhoneNumberId ? { tenantPhoneNumberId } : {}),
};

if (env.SENDERO_API_KEY) {
  headers['X-API-Key'] = env.SENDERO_API_KEY;
} else if (env.SENDERO_DISPATCH_SECRET) {
  headers['x-sendero-dispatch-secret'] = env.SENDERO_DISPATCH_SECRET;
  // Optional last-resort fallback. Sendero will prefer `tenantPhoneNumberId`
  // → ChannelIdentity → sandbox before honoring this.
  if (env.SENDERO_TENANT_ID) {
    forwardBody.tenantId = env.SENDERO_TENANT_ID;
  }
}
```

### 4.5 Acceptance criteria

- [ ] A live Kapso run logs `tenantPhoneNumberId: 597907523413541` in the `forwardBody` it POSTs to Sendero.
- [ ] Sendero `/api/tools/traveler_balance` returns the wallet for a known traveler **without** `SENDERO_TENANT_ID` set in Kapso env.
- [ ] When two tenants have installed the sandbox number, the resolver returns the traveler's most-recent binding (verified via the `keyId: shared-secret:channel_identity_recent` audit signal).
- [ ] Unsetting `SENDERO_TENANT_ID` does not break the demo (sandbox fallback covers cold-start).
- [ ] `bun langfuse:regression` does not regress on `whatsapp-wallet-check` scenarios.

---

## 5. PR-2 — Switch-agency UX

### 5.1 Goal

A traveler with `ChannelIdentity` rows in multiple agencies (e.g. a power user who has tested 3 demos) can explicitly flip their active context. Without this, the resolver's "most recently updated" heuristic is the only flip mechanism, which is unintuitive.

### 5.2 Files to change

**New:**
- `packages/tools/src/switch-active-agency.ts` — canonical tool. Input: `{ tenantSlug: string }`. Behavior: look up the candidate set of tenants the traveler is already bound to. If `tenantSlug` matches one of them, touch its `ChannelIdentity.updatedAt`. Return the new active agency.
- `packages/tools/src/switch-active-agency.test.ts` — unit tests.

**Modify:**
- `packages/tools/src/index.ts` — register tool.
- `packages/tools/src/pricing.ts` — `switch_active_agency: '0'`.
- `packages/tools/src/scopes.ts` — `read` scope.
- `apps/app/lib/channel-render/channels/whatsapp.ts` — if the inbound text matches `/^@switch (\w[-\w]*)$/i`, run the tool and emit a confirmation card.

### 5.3 Input contract

```ts
const switchAgencySchema = z.object({
  tenantSlug: z.string().min(1).max(120),
});
```

### 5.4 Algorithm

1. Resolve the traveler's User from `ctx.traveler.userId`. Fail closed if `svc:`.
2. Query `ChannelIdentity { kind: 'whatsapp', externalUserId: phone }` joined with `Tenant`. Build the set of `{tenantId, tenantSlug, displayName}`.
3. If `tenantSlug` is not in the set, return `{ status: 'not_bound', message: 'You aren't connected to that agency yet. Ask them for an invite link.', candidates: [...] }`.
4. Otherwise touch `ChannelIdentity.update({ where: { id }, data: { updatedAt: new Date() } })` for the chosen tenant.
5. Return `{ status: 'switched', tenantSlug, displayName, message: 'You're now talking to <displayName>.' }`.

### 5.5 Render

WhatsApp interactive reply with the agency's brand color + a one-line confirmation. If `status: 'not_bound'`, include up to 3 quick-reply buttons for tenants the traveler IS bound to.

### 5.6 Acceptance criteria

- [ ] `@switch enterprise-test` flips active tenant when traveler has a ChannelIdentity in that tenant.
- [ ] Switching survives a full message round-trip — next inbound resolves to the switched tenant via `channel_identity_recent`.
- [ ] Switching to an unknown slug fails with `not_bound` and surfaces candidates.
- [ ] Tool requires no special scope beyond `read`.

---

## 6. PR-3 — Protected-tenant delete guard

### 6.1 Goal

Today no admin route deletes a tenant; this PR adds the guard in advance so when a delete route lands it can't accidentally take the sandbox down.

### 6.2 Files to change

**New:**
- `apps/app/lib/tenant-deletion-guard.ts`:
  ```ts
  export async function assertTenantDeletable(tenantId: string): Promise<void> {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true, slug: true },
    });
    if (!t) return; // delete of non-existent is a no-op upstream
    const protectedFlag = (t.metadata as Record<string, unknown> | null)?.protected === true;
    if (protectedFlag) {
      throw new TenantProtectedError(t.slug);
    }
  }
  ```
- `apps/app/lib/tenant-deletion-guard.test.ts` — happy + protected paths.

**Modify (when delete routes are added later):**
- `apps/app/app/api/admin/tenants/[id]/delete/route.ts` — call `assertTenantDeletable` before the prisma delete. Map `TenantProtectedError` → `409 tenant_protected`.

### 6.3 Documentation

- Add a one-line note to `CLAUDE.md` under the "Meta admin" section: "Tenants with `metadata.protected === true` cannot be deleted via dashboard. Run `bun apps/app/scripts/_local/provision-sandbox-tenant.ts` to recreate one if removed via raw SQL."
- Note in `docs/document-first-agent-spec.md` and this spec that operators editing tenants via Prisma Studio bypass the guard — that's a known limitation, documented not enforced.

### 6.4 Acceptance criteria

- [ ] `assertTenantDeletable` throws when called against the sandbox tenant.
- [ ] `assertTenantDeletable` is a no-op for normal tenants.
- [ ] Unit tests pass.

---

## 7. Sequencing

1. PR-1 first. Standalone — drops env-var fragility, unblocks every Kapso demo.
2. PR-2 second. Optional but cheap polish.
3. PR-3 anytime — independent of the other two.

Each PR runs `bun test` + `bun langfuse:regression` clean and goes through `/codex review` before merge.

---

## 8. What Claude will do after Codex finishes

- Copy pass on the switch-agency tool's confirmation messages (Spanish + English).
- Branded WhatsApp interactive button colors per agency.
- Operator dashboard surface for "which agencies has this traveler bound to" (read-only panel on `/dashboard/customer-accounts/[id]`).
- Update `CLAUDE.md` to document the resolver priority chain as canonical.

Claude will **not** change:
- Resolver priority order
- Kapso function shape
- Tool input/output contracts
- The protected-tenant guard logic

---

## 9. Anti-goals (do not do)

- Do not reintroduce a primary `SENDERO_TENANT_ID` dependency.
- Do not let the resolver return a tenant that fails `tenantExists()`.
- Do not auto-resolve to the sandbox tenant when the traveler IS bound to an existing live tenant.
- Do not change `WhatsAppInstall.tenantId @unique` — that constraint is correct.
- Do not move tenant resolution into Kapso functions. Sendero stays canonical.
- Do not log raw `flow_info` blobs (they carry PII). Log only `tenantPhoneNumberId` + first 6 chars of phone.

---

## 10. Definition of done

- Kapso's `SENDERO_TENANT_ID` can be unset without breaking any demo conversation.
- A new traveler messaging the sandbox bot for the first time lands in the sandbox tenant and can browse / book.
- A returning traveler always lands in the tenant they last interacted with.
- A traveler bound to multiple agencies can `@switch <slug>` between them.
- The sandbox tenant cannot be removed via the admin route.
- `bun test`, `bun langfuse:regression`, and `/codex review` are clean on each PR.

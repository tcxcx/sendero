# BUFI Pasillo local-smoke blockers — found via cross-repo round-trip

**Date:** 2026-05-13
**Found by:** Sendero `@sendero/pasillo-client` smoke against `desk-v1/apps/pasillo`
on `private-multisig` (post `bun run dev:setup && bun run dev:auth-stack`).

Two distinct bugs in BUFI's Pasillo middleware surfaced during the first
end-to-end auth-path round-trip. Sendero side is fully functional; both bugs
are server-side. File these patches with the BUFI team.

---

## Bug 1 — KV PUT in `hmacVerify` violates Cloudflare KV's minimum TTL

### Symptom

Every signed request from Sendero gets a 500 response with body:

```json
{"success":false,"error":{"message":"Internal server error","code":"INTERNAL_ERROR","requestId":"<id>"}}
```

Worker stderr shows:

```
ERROR  worker-base:error  {
  "level":"error",
  "path":"/ramp/quote",
  "method":"POST",
  "status":500,
  "message":"KV PUT failed: 400 Invalid expiration_ttl of 30. Expiration TTL must be at least 60.",
  "stack":"...at async hmacVerify (...)"
}
```

The `pasillo:sendero-audit` log line confirms OIDC verify already
succeeded (`identity={sub: 'prj_sendero_local_dev', iss: 'https://oidc.vercel.com/sendero-local-dev', ...}`),
so this is purely a downstream KV-write bug, not auth.

### Root cause

`hmacVerify`'s replay-nonce dedup writes a key to `PASILLO_KV` with
`expirationTtl: 30` (seconds). Cloudflare KV enforces a hard floor of
**60 seconds** on `expirationTtl`; anything below returns 400.

Stack trace points at the bundled location:

```
file:///apps/pasillo/.wrangler/tmp/dev-XpkTI1/index.js:30776:5
  at async hmacVerify (...:30956)
```

In source: `apps/pasillo/src/middleware/hmac-verify.ts`.

### Fix

Bump the TTL to ≥ 60. A pragmatic value is `expirationTtl: 60` to match
the CF floor, OR `expirationTtl: 600` (10 min — well above replay-window
of 5 min, gives Pasillo headroom even if a malicious client retries a
captured signature).

```ts
// before
await env.PASILLO_KV.put(`hmac:nonce:${key}`, '1', { expirationTtl: 30 });

// after
await env.PASILLO_KV.put(`hmac:nonce:${key}`, '1', { expirationTtl: 600 });
```

### Why no one caught this in BUFI's 9-case adversarial smoke

BUFI's own `dev:auth-stack` smoke ran against miniflare's in-memory KV
which historically didn't enforce the 60s floor. Newer miniflare /
wrangler 4.x **does** enforce it locally to match production. Upgrade
of wrangler 4.83.0 likely brought this in.

---

## Bug 2 — jose `RemoteJWKSet` caches negative-fetch result

### Symptom

Some Sendero requests get:

```
401 Unauthorized
"Invalid Vercel OIDC token: no applicable key found in the JSON Web Key Set"
```

The token's `kid` (`dev-oidc-1`) matches the JWKS served by the OIDC
mock at `http://127.0.0.1:8788/.well-known/jwks.json`. Manual verification
with the same `jose` library on Node succeeds against the same token +
JWKS pair. Fails inside the wrangler worker.

### Root cause hypothesis

`createRemoteJWKSet` in `apps/pasillo/src/middleware/vercel-oidc.ts:46`
uses `cacheMaxAge: 3600_000` (1 hour). When the very first JWKS fetch
runs (e.g., during a previous boot where `ENABLE_VERCEL_OIDC` was off, or
when `localhost` was unreachable from inside workerd before the
`.dev.vars` edit), the negative result is cached. Subsequent requests
hit the cache and return "no applicable key found" until isolate
respawn.

Workaround: bounce `dev:auth-stack` after any `.dev.vars` edit. **Not
production-safe** — if Vercel rotates its signing key, Pasillo will 401
all traffic for up to an hour until the worker recycles.

### Suggested fix

Lower `cacheMaxAge` and add explicit `cooldownDuration` so jose's negative
cache window is short:

```ts
createRemoteJWKSet(new URL(url), {
  cacheMaxAge: 600_000,        // 10 min — Vercel's actual rotation cadence is hours
  cooldownDuration: 30_000,    // 30s before retrying a failed fetch
});
```

OR plumb a manual refresh path: if jose returns "no applicable key" with
a non-stale token (timestamp within window), delete from `jwksByUrl` and
retry once.

---

## Sendero-side state — green, blocked downstream

`@sendero/pasillo-client` was verified clean during this debug:

| Layer | Status |
|---|---|
| OIDC resolver (env-driven, dev-mock fallback) | ✅ Reads `PASILLO_DEV_OIDC_TOKEN_URL` correctly |
| HMAC signer (Stripe pattern) | ✅ Output matches BUFI's exact curl recipe byte-for-byte |
| Body shape | ✅ `amount: number`, `corridor: 'US-EC'` etc., aligned with `desk-v1/apps/pasillo/src/common/schema.ts` |
| Idempotency key | ✅ UUIDv4 per POST |
| Header set | ✅ Authorization + X-Sendero-Sig + X-Sendero-Tenant-Id + X-Idempotency-Key |

13 unit tests passing in `packages/pasillo-client/src/__tests__/`.
Local jose verify of the OIDC mock's token via `jose-local-verify.ts`
succeeds — confirming the token is valid.

---

## Resume path after fixes

Once BUFI ships the two patches:

```bash
# Sendero side
bun apps/app/scripts/_local/pasillo-roundtrip-smoke.ts
# Expected: 200 + a valid quote response, OR 4xx for a missing config
# field (Circle Mint creds, etc.) — anything but 401/500 means the auth
# + signing stack passed end-to-end.
```

Capture the quote response and the `pasillo:sendero-audit` log line on
the BUFI side. Both should show `outcome: 'success'` and matching
`jti` (so audit reconciliation works).

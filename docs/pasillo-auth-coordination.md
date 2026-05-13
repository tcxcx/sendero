# Pasillo Auth — Sendero ↔ BUFI Coordination

> **Audience:** BUFI / desk-v1 maintainers. Spec for the Pasillo-side changes needed before Sendero can call `api.pasillo.bufi.io` from production.
>
> **Sendero owner:** @criptopoeta
> **BUFI owner:** TBD
> **Status:** spec — code on neither side yet
> **Target:** ship behind feature flag on both sides; flip together.

---

## 1. Context

Sendero (Vercel-hosted, Next.js, the consumer) wants to call Pasillo (Cloudflare Worker, Hono, the provider) for USD↔USDC ramp operations + customer KYC management. Pasillo's existing auth surface today:

- **Shiva bearer tokens** (via service binding `env.SHIVA.fetch('https://shiva/users/me')`) — for BUFI-internal staff/UI use.
- **`API_SECRET_KEY` shared secret** — for cross-service worker-to-worker calls inside BUFI.
- **Planned: per-B2B-customer D1 keys + Persona KYC** (per `apps/pasillo/docs/plans/2026-02-27-customer-identity-design.md`).

None of these is the right primitive for a **production Vercel-hosted B2B consumer**. Sendero proposes a **fourth auth path** sitting alongside the existing ones:

## 2. Decision

Sendero → Pasillo uses **Vercel OIDC (identity) + HMAC (body integrity, replay protection)**, layered.

| Layer | Purpose | Lifetime | Where the secret lives |
|---|---|---|---|
| Vercel OIDC token | Identity (Sendero is who it says it is) | ~15min, auto-rotated | Vercel's signing key (asymmetric, FIPS-compliant) — no Sendero-side custody |
| HMAC over `${ts}.${body}` | Body integrity + replay defense | Per-request (5min replay window) | Shared symmetric secret in both Vercel + CF env, rotated quarterly with overlap |

**Why two layers:**

- OIDC alone: leaked token = 15min of impersonation against any endpoint
- HMAC alone: phishable shared secret, no auto-rotation
- Together: attacker needs both the OIDC token AND the HMAC secret AND must craft a body that matches both signatures within 5min. Realistic blast radius ≈ 0.

**Why not the alternatives** (kept here so the conversation doesn't restart):

- Long-lived Shiva bearer in Sendero env — long-lived secret, plaintext at rest, no rotation discipline. Doesn't meet PCI-DSS 4.0 § 8.3.
- KMS-signed JWT (Sendero mints, Pasillo verifies via Google JWKS) — equivalent security, more code, requires Sendero-side KMS asymmetric sign infra. Vercel OIDC achieves the same with zero Sendero custody.
- mTLS — CF Workers doesn't support client certs natively. Operational tax not worth it pre-mainnet.

## 3. What Pasillo needs to add

All paths relative to `apps/pasillo/src/`.

### 3.1 New middleware file: `middleware/vercel-oidc.ts`

Verifies a JWT issued by Vercel's OIDC service.

```ts
// middleware/vercel-oidc.ts
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { BearerTokenResolver } from '@bu/worker-base/middleware';
import { HTTPException } from 'hono/http-exception';

// One JWKS per environment-scoped issuer; cache 1h in module memory.
// CF Workers re-spins isolates so this is effectively per-isolate, which is fine.
const VERCEL_JWKS = createRemoteJWKSet(
  new URL('https://oidc.vercel.com/.well-known/jwks.json'),
  { cacheMaxAge: 3600_000 }
);

const ALLOWED_ISSUERS = new Set([
  'https://oidc.vercel.com/sendero-travel',
  // Add preview / dev issuers as Sendero deploys gain them.
]);

const REQUIRED_AUDIENCE = 'api.pasillo.bufi.io';

export const vercelOidcResolver: BearerTokenResolver = async (token, c) => {
  try {
    const { payload } = await jwtVerify(token, VERCEL_JWKS, {
      audience: REQUIRED_AUDIENCE,
      clockTolerance: 30,
    });

    const iss = String(payload.iss ?? '');
    if (!ALLOWED_ISSUERS.has(iss)) {
      throw new HTTPException(401, { message: 'OIDC issuer not allowed' });
    }

    return {
      userId: `vercel:${payload.sub}`,        // Vercel project id
      teamId: String(payload.owner_id ?? ''),  // Vercel team id
    };
  } catch (err) {
    throw new HTTPException(401, {
      message: `Invalid Vercel OIDC token: ${(err as Error).message}`,
    });
  }
};
```

Add `jose` to `apps/pasillo/package.json` dependencies (`^5.x`).

### 3.2 New middleware file: `middleware/hmac-verify.ts`

Verifies the `X-Sendero-Sig` header (Stripe-pattern signing over `${ts}.${body}`).

```ts
// middleware/hmac-verify.ts
import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';

const REPLAY_WINDOW_SECONDS = 300;

function parseSig(header: string): { t: string; v1: string } {
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), v?.trim() ?? ''];
    })
  );
  if (!parts.t || !parts.v1) {
    throw new HTTPException(401, { message: 'malformed X-Sendero-Sig' });
  }
  return { t: parts.t, v1: parts.v1 };
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const hmacVerify: MiddlewareHandler = async (c, next) => {
  const sigHeader = c.req.header('X-Sendero-Sig');
  if (!sigHeader) {
    throw new HTTPException(401, { message: 'missing X-Sendero-Sig' });
  }
  const { t, v1 } = parseSig(sigHeader);

  const tsNum = Number(t);
  if (!Number.isFinite(tsNum)) {
    throw new HTTPException(401, { message: 'bad timestamp' });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > REPLAY_WINDOW_SECONDS) {
    throw new HTTPException(401, { message: 'timestamp out of window' });
  }

  // Read body, then re-inject for downstream handlers.
  const body = await c.req.text();
  const signed = `${t}.${body}`;

  const env = c.env as { PASILLO_HMAC_SECRET: string; PASILLO_HMAC_SECRET_PREV?: string };
  const expected = await hmacHex(signed, env.PASILLO_HMAC_SECRET);
  const expectedPrev = env.PASILLO_HMAC_SECRET_PREV
    ? await hmacHex(signed, env.PASILLO_HMAC_SECRET_PREV)
    : null;

  const ok =
    timingSafeEqual(v1, expected) ||
    (expectedPrev !== null && timingSafeEqual(v1, expectedPrev));
  if (!ok) {
    throw new HTTPException(401, { message: 'HMAC mismatch' });
  }

  // Re-inject body so the route handler can read it again.
  c.req.raw = new Request(c.req.raw, { method: c.req.method, headers: c.req.raw.headers, body });

  await next();
};
```

### 3.3 Extend existing `middleware/auth.ts`

Add a routing layer that picks the right resolver by JWT shape vs opaque Shiva token.

```ts
// middleware/auth.ts (extension)
import { vercelOidcResolver } from './vercel-oidc';

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

function peekJwtIssuer(token: string): string | null {
  try {
    const [, payloadB64] = token.split('.');
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { iss?: string };
    return payload.iss ?? null;
  } catch {
    return null;
  }
}

// Compose the existing shivaBearerResolver with the new vercelOidcResolver.
const composedBearerResolver: BearerTokenResolver = async (token, c) => {
  if (looksLikeJwt(token)) {
    const iss = peekJwtIssuer(token);
    if (iss && iss.startsWith('https://oidc.vercel.com/')) {
      return vercelOidcResolver(token, c);
    }
  }
  return shivaBearerResolver(token, c);
};

export const authMiddleware = createAuthMiddleware({
  publicPaths: ['/health', '/swagger', '/api-docs'],
  passthroughPrefixes: ['/ramp/webhook', '/customers/webhook'],
  bearerResolver: composedBearerResolver,
});
```

### 3.4 Wire HMAC verify into `src/index.ts`

After `authMiddleware`, before route handlers. Skip for webhook passthrough paths.

```ts
// index.ts — inside the middleware chain, after authMiddleware
app.use('/ramp/quote', hmacVerify);
app.use('/ramp/on',    hmacVerify);
app.use('/ramp/off',   hmacVerify);
app.use('/ramp/status/*', hmacVerify);
app.use('/customers/*', async (c, next) => {
  // Skip Persona inbound webhook
  if (c.req.path.endsWith('/persona')) return next();
  return hmacVerify(c, next);
});
app.use('/settle/*', hmacVerify);
```

Webhooks (`/ramp/webhook/*`, `/customers/:id/persona`) skip HMAC by design — they're inbound from third parties (Producbanco, Pichincha, Persona), not from Sendero.

### 3.5 Secrets

Per environment (`wrangler secret put ... --env <env>`):

```bash
wrangler secret put PASILLO_HMAC_SECRET --env production
wrangler secret put PASILLO_HMAC_SECRET_PREV --env production  # optional, for rotation overlap
```

Generate with `openssl rand -base64 64` (64 bytes = 512 bits, well over HMAC-SHA256 needs).

### 3.6 Tests

New: `src/__tests__/vercel-oidc.test.ts`, `src/__tests__/hmac-verify.test.ts`. Mock JWKS endpoint, golden HMAC vectors. Reject malformed sig, expired ts, wrong audience, wrong issuer, body tamper.

## 4. What Sendero is doing on its side (context only — not your concern)

- Enable OIDC on Sendero's Vercel project, audience `api.pasillo.bufi.io`, issuer `https://oidc.vercel.com/sendero-travel`
- Build `packages/pasillo-client/` (oidc reader + hmac signer + http client)
- Set `PASILLO_HMAC_SECRET` in Sendero Vercel env at `target:["production","preview","development"]`
- New `PasilloCall` Prisma model: jti, idempotencyKey, reqHashSha256, traceId for daily reconcile

No code from Sendero side needs to land in desk-v1.

## 5. Secret rotation handshake

Quarterly cadence. One-week overlap window. Procedure:

1. **T-7d** (Sendero): generate new secret `S_new` (64 bytes base64). Stored in 1Password vault `sendero-pasillo`.
2. **T-7d** (Sendero): add `PASILLO_HMAC_SECRET_NEXT=S_new` env in Vercel at all-target scope. Sendero client signs with `PASILLO_HMAC_SECRET` (still old) — no behavior change yet.
3. **T-7d** (BUFI): `wrangler secret put PASILLO_HMAC_SECRET_PREV=S_old` then `wrangler secret put PASILLO_HMAC_SECRET=S_new`. Pasillo now accepts BOTH. Sendero still sending with `S_old` — still works.
4. **T-0** (Sendero): rename `PASILLO_HMAC_SECRET_NEXT` → `PASILLO_HMAC_SECRET`, redeploy. Sendero now signs with `S_new`. Pasillo verifies against `S_new` primary, `S_old` fallback.
5. **T+7d** (BUFI): `wrangler secret delete PASILLO_HMAC_SECRET_PREV`. Old secret retired.

Sign-off required from both sides at each step. Roll back at any step by reverting env values — no migration.

## 6. Rollout plan

| Phase | What | Acceptance |
|---|---|---|
| 1. Spec sign-off | Both maintainers approve this doc | This file merged |
| 2. Parallel build | Sendero builds `pasillo-client`; BUFI builds `vercel-oidc.ts` + `hmac-verify.ts`. Both behind feature flag (`ENABLE_VERCEL_OIDC=false` env, default off) | PRs in review on both sides |
| 3. Staging cutover | Generate first `PASILLO_HMAC_SECRET`, deploy to Sendero preview + Pasillo staging. Flip flag on. Sendero preview calls Pasillo staging `/ramp/quote` end-to-end. | 1 successful round-trip with valid OIDC + HMAC |
| 4. Adversarial smoke | Sendero deliberately sends bad sig, expired ts, wrong audience, tampered body. Pasillo returns 401 in each case. | All four 401s logged |
| 5. Production flip | Set flag on in prod env (both sides simultaneously). Monitor Cloud Audit Logs + CF Worker logs for 24h. | Zero auth failures from legitimate Sendero traffic |
| 6. Deprecate old path | Once Sendero is fully on OIDC+HMAC, BUFI can flag-protect or remove the `API_SECRET_KEY` fallback for the Sendero call path. | Tracked separately |

## 7. Acceptance criteria

- [ ] Sendero can call `POST /ramp/quote` with valid OIDC + HMAC and receive a quote
- [ ] Calls without OIDC token → 401 `Authentication required`
- [ ] Calls with valid OIDC but no HMAC → 401 `missing X-Sendero-Sig`
- [ ] Calls with HMAC over different body than sent → 401 `HMAC mismatch`
- [ ] Calls with ts older than 5min → 401 `timestamp out of window`
- [ ] Calls with OIDC `aud` ≠ `api.pasillo.bufi.io` → 401 `audience invalid`
- [ ] Calls with OIDC `iss` not in allowlist → 401 `OIDC issuer not allowed`
- [ ] Rotation handshake completed end-to-end in staging without auth interruption
- [ ] OpenAPI spec at `/api-docs` documents the new headers
- [ ] Cloud Audit Logs show one entry per successful OIDC verify
- [ ] Sendero `PasilloCall` rows reconcile 1:1 with Pasillo request logs by `jti` over a 24h window

## 8. Open questions for BUFI

1. **Which Vercel OIDC issuer slug?** Sendero's prod deployment will issue tokens at `https://oidc.vercel.com/<team>`. Confirm the exact team slug to put in `ALLOWED_ISSUERS`. (Sendero's team appears to be `sendero-travel`; verify.)
2. **CF Worker JWKS cache strategy.** The example uses module-level caching (per-isolate). Alternative: CF KV with 1h TTL. Preference?
3. **Per-tenant rate limiting.** Pasillo today rate-limits by `customerId`. For Sendero traffic, the OIDC `sub` is a single Vercel project — all Sendero tenants share. Should we (a) accept that the rate limit applies to all of Sendero's combined traffic, or (b) bucket by the `X-Sendero-Tenant-Id` header (covered by HMAC, so not forgeable)?
4. **Do we keep `API_SECRET_KEY` for the Sendero call path?** After OIDC+HMAC ships, the `API_SECRET_KEY` is redundant for Sendero. Suggest BUFI deprecate it for that path; keep only for intra-BUFI service bindings.
5. **Persona-KYC interaction.** Pasillo's planned per-customer flow gates ramp execution on KYC approval. Sendero (as a B2B caller) needs a KYC status equivalent. Does Sendero get a "customer" record on Pasillo's D1 with KYC pre-approved (via a manual op-side toggle), or do we treat Vercel OIDC + Sendero's own KYC stack as the trust root and skip Pasillo's KYC gate?

---

**Suggested next step:** BUFI maintainer reviews this doc and answers the open questions in section 8. Sendero starts on Sendero-side scaffolding in parallel (`packages/pasillo-client/`). Two PRs land roughly simultaneously, flag off, flag-on after staging smoke passes.

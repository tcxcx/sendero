# Clerk Dashboard Setup

One-time configuration steps for a fresh Clerk application powering Sendero × Arc. Run through once per environment (dev / staging / prod).

## 1. Create application

1. Go to https://dashboard.clerk.com → **+ Create application**.
2. Name: `sendero-<env>`.
3. Sign-in methods:
   - **Email**: enabled (verification code preferred)
   - **Google OAuth**: enabled
   - **Passkeys**: enabled (can be added post-sign-up)

## 2. Enable Organizations

1. Settings → Organizations → **Enable Organizations**.
2. **Membership required** — every user must belong to an organization.
3. **Personal Accounts** — **disabled** (B2B only).
4. **User-created organizations** — enabled (users create their own tenant on sign-up).
5. **Organization creation limit** — 100/user (default).
6. **Default role for new members** — `org:member`.
7. **Creator role** — `org:admin`.
8. **Organization slugs** — enabled.

## 3. Custom role

1. Settings → Roles & Permissions → **+ Add role**.
2. Name: `Finance`. Key: `org:finance`.
3. Permissions: Read members, Read billing. Nothing write.
4. Do not set as default; this is invited manually.

## 4. Customize session token claims

1. Settings → Sessions → **Customize session token**.
2. Claims JSON editor:
   ```json
   {
     "metadata": "{{user.public_metadata}}",
     "org_metadata": "{{org.public_metadata}}"
   }
   ```
3. Save. Total payload stays well under the 1.2KB cookie budget (claims are a tenantId cuid + address hex + booleans).

## 5. Webhook endpoint

1. Settings → Webhooks → **+ Add endpoint**.
2. URL: `https://<deploy-url>/api/webhooks/clerk`.
3. Subscribe to events:
   - `user.created`, `user.updated`, `user.deleted`
   - `organization.created`, `organization.updated`, `organization.deleted`
   - `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`
4. Copy **Signing Secret** → set as `CLERK_WEBHOOK_SECRET` in Vercel env (Preview + Production).

## 6. Redirect URLs

In **Paths**:

- Sign-in URL: `/sign-in`
- Sign-up URL: `/sign-up`
- After sign-in: `/onboarding`
- After sign-up: `/onboarding`

Or set via env in `apps/app` `.env.local`:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding
```

## 7. API keys

1. Settings → API Keys → copy the three values:
   - `CLERK_SECRET_KEY` (server)
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (client)
2. Add to Vercel env (Development + Preview + Production) on project `sendero-arc-web`.

## 8. Smoke verify

```bash
bun run env:validate        # all-green
bun run smoke:clerk-webhook # signs a test payload + POSTs the webhook route
```

Open `/sign-up` in a browser → create a fresh user → assert redirect to `/onboarding` → create an Organization → wait for wallet provisioning → land in `/app`.

## 9. Post-setup: ongoing ops

- **Add org:finance role to a user**: Dashboard → Users → (user) → Organizations → (org) → change role to Finance.
- **Enable MFA**: Settings → Multi-factor → toggle on authenticator app + SMS backup.
- **Verified domains** (agency auto-invite): Settings → Organizations → Verified domains → enable (phase-11d wires the UI).

## Troubleshooting

- Webhook signature rejected (401): confirm `CLERK_WEBHOOK_SECRET` matches the Dashboard value exactly — no whitespace.
- Session claims empty on server: cookie too large → reduce custom claims (max ~1.2KB).
- `choose-organization` task loops: ensure Personal Accounts disabled; `/onboarding/choose-org` matches the `taskUrls` prop on `<ClerkProvider>` (phase-11c1's `<SenderoClerkProvider>` doesn't set this; fall back to Account Portal for now — phase-11d wires custom task URLs).

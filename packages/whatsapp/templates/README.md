# Sendero WhatsApp HSM templates

Pre-approved Meta templates required for first-touch (out-of-session)
WhatsApp messages. Inside the 24-hour customer service window we use
free-form `text` messages; outside it Meta returns `(#131047)` and the
caller falls back to one of these templates.

## Templates

| File | Meta name | Category | Purpose |
| ---- | --------- | -------- | ------- |
| `sendero_otp.json` | `sendero_otp` | AUTHENTICATION | OTP resend for guest claim. Body var = preimage code. Meta auto-renders the body copy + COPY_CODE button. |
| `sendero_security_alert.json` | `sendero_security_alert` | UTILITY | Lockout / security ping to the buyer when the agency is in-channel. Header var = subject, body var = alert text. |

Each entry must also be present in
`packages/whatsapp/src/templates.ts → SENDERO_TEMPLATES` so the typed
sender can construct the components array (see
`buildOtpComponents`, `buildSecurityAlertComponents`).

## Submission flow (Meta WABA via Kapso proxy)

These templates need Meta approval (typically 24-72 hours, often <1 hr
for AUTHENTICATION). Use the `integrate-whatsapp` Claude skill scripts
which proxy to Meta through `api.kapso.ai/meta/whatsapp/v24.0`.

Prerequisites:

```bash
# Authenticate the Kapso CLI once.
kapso login

# Discover the WABA + phone-number IDs Meta assigned to Sendero.
node ~/.claude/skills/integrate-whatsapp/scripts/list-platform-phone-numbers.mjs
# → prints { business_account_id, phone_number_id, display_phone_number }
```

Submit each template:

```bash
# OTP (AUTHENTICATION). Approval is usually fast — Meta has a fast-track
# review for the first-party AUTHENTICATION category.
node ~/.claude/skills/integrate-whatsapp/scripts/create-template.mjs \
  --business-account-id <WABA_ID> \
  --file packages/whatsapp/templates/sendero_otp.json

# Security alert (UTILITY). Manual review; copy is generic enough that
# rejections are rare, but be ready to rephrase if Meta flags it.
node ~/.claude/skills/integrate-whatsapp/scripts/create-template.mjs \
  --business-account-id <WABA_ID> \
  --file packages/whatsapp/templates/sendero_security_alert.json
```

Poll for approval:

```bash
node ~/.claude/skills/integrate-whatsapp/scripts/template-status.mjs \
  --business-account-id <WABA_ID> --name sendero_otp
node ~/.claude/skills/integrate-whatsapp/scripts/template-status.mjs \
  --business-account-id <WABA_ID> --name sendero_security_alert
# → status: APPROVED | PENDING | REJECTED
```

Once both report `APPROVED`, the runtime fallback in
`apps/app/lib/security-alert-senders.ts` and
`apps/app/app/api/trip/[tripId]/claim-code/resend/route.ts` will start
using them automatically the next time Meta returns `(#131047)`.

## Adding additional locales

Each `(name, language)` pair is a separate Meta template. To add
`es_MX`:

1. Copy the JSON, change `"language"` to `"es_MX"`, translate any
   user-visible strings (the OTP template has none — Meta translates
   for you), update the example body for the security-alert template.
2. Submit via the same `create-template.mjs` flow.
3. Add `'es_MX'` to the corresponding entry's `fallbackLocales` array
   in `packages/whatsapp/src/templates.ts`.

`resolveTemplateLocale()` already picks the closest approved locale
based on the BCP-47 tag the caller passes.

## Verifying a send

After approval, the easiest sanity check is the kapso CLI:

```bash
kapso whatsapp templates list --phone-number-id <PHONE_NUMBER_ID> --output json | \
  jq '.[] | select(.name=="sendero_otp")'

# Optional dry-run send (uses the SDK send-template pattern; substitute
# a real recipient and code).
node ~/.claude/skills/integrate-whatsapp/scripts/send-template.mjs \
  --phone-number-id <PHONE_NUMBER_ID> \
  --to +15551234567 \
  --template sendero_otp \
  --language en_US \
  --body-params 123456 \
  --button-otp 123456
```

If a real send hits `(#132000)` (template not found) the registry name
in code and the Meta-registered name have drifted — fix the constant in
`SENDERO_TEMPLATES`.

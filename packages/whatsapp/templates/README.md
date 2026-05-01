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
| `sendero_trip_intake_start.json` | `sendero_trip_intake_start` | UTILITY | Invites a traveler to complete structured trip intake. |
| `sendero_quote_ready.json` | `sendero_quote_ready` | UTILITY | Sends quote-ready notification with secure approval link. |
| `sendero_action_required.json` | `sendero_action_required` | UTILITY | Generic secure action approval reminder. |
| `sendero_booking_confirmed.json` | `sendero_booking_confirmed` | UTILITY | Booking confirmation with PNR, route, departure, and ticket email. |
| `sendero_ticket_delivery.json` | `sendero_ticket_delivery` | UTILITY | Confirms ticket or receipt delivery to email. |
| `sendero_disruption_alert.json` | `sendero_disruption_alert` | UTILITY | Flight/trip disruption notification with support link. |
| `sendero_handoff_update.json` | `sendero_handoff_update` | UTILITY | Operator or support lifecycle update. |
| `sendero_prefund_invite.json` | `sendero_prefund_invite` | UTILITY | Prefunded trip claim invitation. Secure code is delivered to ticket email, not WhatsApp. |
| `sendero_payment_link.json` | `sendero_payment_link` | UTILITY | Secure payment or deposit link. |
| `sendero_escrow_update.json` | `sendero_escrow_update` | UTILITY | Escrow held/released/validation state update. |
| `sendero_nft_stamp_ready.json` | `sendero_nft_stamp_ready` | UTILITY | NFT trip stamp/gallery notification. |
| `sendero_profile_update_required.json` | `sendero_profile_update_required` | UTILITY | Missing traveler profile or ticket-delivery data reminder. |

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

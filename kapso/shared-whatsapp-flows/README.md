# Sendero Shared WhatsApp Flows

Canonical WhatsApp Flow JSON and data endpoint contracts reused by:

- `kapso/sendero-whatsapp-support-agent`
- `kapso/sendero-tenant-travel-agent`

The support agent is the live-test harness because it already owns the Sendero support sandbox number. Tenant flows reuse the same JSON and endpoint response contract after a tenant connects a dedicated WhatsApp Business number.

## Flow Rules

- Flow JSON uses `version: "7.3"`.
- Dynamic Flow endpoints use `data_api_version: "3.0"`.
- Kapso owns registration, publishing, encryption, endpoint URLs, signature verification, preview URLs, and invocation logging.
- Function endpoints are plain uploaded Worker files with `async function handler(request, env)` and no imports, exports, CommonJS, or TypeScript build step.
- Every endpoint persists through `/api/internal/support/tools`; that route wraps the operation in `@sendero/langfuse`, scores tool success and latency, returns `traceId`, and echoes `x-sendero-trace-id`.
- Dynamic endpoint responses always include:

```json
{
  "version": "3.0",
  "screen": "NEXT_SCREEN",
  "data": {}
}
```

## Flows

- `flows/login-signup.flow.json`: WhatsApp account creation/linking, traveler profile, wallet consent, and persistent trip gallery setup.
- `flows/trip-intake.flow.json`: structured trip, quote, traveler, approval, and handoff intake.
- `flows/support-intake.flow.json`: support request intake for setup, billing/refund, booking/trip, escrow/payment, and escalation.
- `flows/quote-approval.flow.json`: quote review and decision capture. It never takes payment or tickets.
- `flows/ancillaries.flow.json`: bags, seats, insurance, lounge, meals, priority boarding, and other paid extra requests.
- `flows/disruption-help.flow.json`: delay, cancellation, missed connection, refund/rebook, hotel, or transport support intake.
- `flows/prefund-claim.flow.json`: prefunded claim guidance. The claim link is usable only with the secure code sent to ticket email; WhatsApp never asks for or verifies that email code.
- `flows/booking-change.flow.json`: change, cancel, or rebook intake. Fare differences, refunds, cancellations, and ticketing stay on secure approval rails.
- `flows/accommodation.flow.json`: hotel/stay request intake with dates, rooms, budget, amenities, and loyalty details.
- `flows/car-transfer.flow.json`: airport transfer, point-to-point ride, or car-rental request intake.
- `flows/restaurant-experience.flow.json`: restaurant and local experience recommendation intake.
- `flows/nft-trip-gallery.flow.json`: trip gallery, stamp resend, explanation, and unlock request intake. Valuable unlock/mint actions require verification or privileged approval.
- `flows/refund-escrow.flow.json`: refund, escrow, settlement, and validation intake only. Money movement and policy overrides require human review and secure approval.

The final submit action for each Flow uses `data_exchange`, not a bare `complete`, so the Kapso data endpoint can write the Sendero record first. On success the endpoint returns `extension_message_response` to close the Flow.

## Live Test Path

1. In Kapso dashboard, create/sync a WhatsApp Flow for the support number.
2. Paste `flows/login-signup.flow.json`, `flows/trip-intake.flow.json`, or `flows/support-intake.flow.json`.
3. Attach the matching endpoint from `functions/*/index.js` if using dynamic mode.
4. Publish or keep in draft mode for testing.
5. Set the resulting Flow id in the support Kapso runtime:
   - `SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID`
   - `SENDERO_SUPPORT_REQUEST_FLOW_ID`
   - `SENDERO_SUPPORT_LOGIN_SIGNUP_FLOW_ID`
   - `SENDERO_SUPPORT_QUOTE_APPROVAL_FLOW_ID`
   - `SENDERO_SUPPORT_ANCILLARIES_FLOW_ID`
   - `SENDERO_SUPPORT_DISRUPTION_HELP_FLOW_ID`
   - `SENDERO_SUPPORT_PREFUND_CLAIM_FLOW_ID`
   - `SENDERO_SUPPORT_BOOKING_CHANGE_FLOW_ID`
   - `SENDERO_SUPPORT_ACCOMMODATION_FLOW_ID`
   - `SENDERO_SUPPORT_CAR_TRANSFER_FLOW_ID`
   - `SENDERO_SUPPORT_RESTAURANT_EXPERIENCE_FLOW_ID`
   - `SENDERO_SUPPORT_NFT_TRIP_GALLERY_FLOW_ID`
   - `SENDERO_SUPPORT_REFUND_ESCROW_FLOW_ID`
6. The support agent can call `send_whatsapp_flow_message`; tenant agent uses the same Flow keys later.

## Validate

```bash
bun run --cwd kapso/shared-whatsapp-flows validate
bun test kapso/shared-whatsapp-flows/tests/*.test.ts
```

`tests/e2e-lifecycle.test.ts` runs each Flow from `INIT` through final `SUCCESS` and asserts the Sendero persistence operation, `flow_token`, `flow_id`, phone-number context, and workflow execution id are present.

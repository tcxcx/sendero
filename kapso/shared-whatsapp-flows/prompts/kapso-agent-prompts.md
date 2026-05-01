# Kapso Agent Prompts For Sendero Flows

Use these prompts in the Kapso dashboard agent when creating or refining the live Flow objects.

## Trip Intake Flow

Create a dynamic WhatsApp Flow named `Sendero Trip Intake`.

Use Flow JSON version `7.3` and data API version `3.0`. The Flow should capture:

- Destination
- Origin
- Start date
- End date
- Trip type: business, leisure, group, other
- Budget
- Notes/constraints
- Primary traveler name
- Traveler email
- Traveler phone
- Traveler count
- Needed products: flights, hotels, transfers, insurance

Use three screens:

- `TRIP_BASICS`
- `TRAVELERS`
- `APPROVAL`

The final screen must summarize the request and complete the Flow. Do not include `endpoint_uri` or `data_channel_uri`; Kapso must inject those. Use the data endpoint contract from `kapso/shared-whatsapp-flows/functions/trip-intake-data-endpoint/index.js`.

## Support Intake Flow

Create a dynamic WhatsApp Flow named `Sendero Support Intake`.

Use Flow JSON version `7.3` and data API version `3.0`. The Flow should capture:

- Support area: WhatsApp setup, trip/booking, billing/refund, escrow/payment, other
- Urgency: normal or urgent
- Reference: support ref, trip ID, invoice ID, phone number ID, or tx hash
- Details
- Preferred contact

Use two screens:

- `SUPPORT_TYPE`
- `SUPPORT_DETAILS`

The final screen must complete the Flow. Do not include `endpoint_uri` or `data_channel_uri`; Kapso must inject those. Use the data endpoint contract from `kapso/shared-whatsapp-flows/functions/support-intake-data-endpoint/index.js`.

## Test Send

## Lifecycle Flow Pack

Create these dynamic WhatsApp Flows with Flow JSON version `7.3` and data API version `3.0`. Do not include `endpoint_uri` or `data_channel_uri`; Kapso injects those.

| Flow name | Flow JSON | Data endpoint |
| --- | --- | --- |
| `Sendero Login Signup` | `kapso/shared-whatsapp-flows/flows/login-signup.flow.json` | `kapso/shared-whatsapp-flows/functions/login-signup-data-endpoint/index.js` |
| `Sendero Trip Intake` | `kapso/shared-whatsapp-flows/flows/trip-intake.flow.json` | `kapso/shared-whatsapp-flows/functions/trip-intake-data-endpoint/index.js` |
| `Sendero Support Intake` | `kapso/shared-whatsapp-flows/flows/support-intake.flow.json` | `kapso/shared-whatsapp-flows/functions/support-intake-data-endpoint/index.js` |
| `Sendero Quote Approval` | `kapso/shared-whatsapp-flows/flows/quote-approval.flow.json` | `kapso/shared-whatsapp-flows/functions/quote-approval-data-endpoint/index.js` |
| `Sendero Ancillaries` | `kapso/shared-whatsapp-flows/flows/ancillaries.flow.json` | `kapso/shared-whatsapp-flows/functions/ancillaries-data-endpoint/index.js` |
| `Sendero Disruption Help` | `kapso/shared-whatsapp-flows/flows/disruption-help.flow.json` | `kapso/shared-whatsapp-flows/functions/disruption-help-data-endpoint/index.js` |
| `Sendero Prefunded Claim` | `kapso/shared-whatsapp-flows/flows/prefund-claim.flow.json` | `kapso/shared-whatsapp-flows/functions/prefund-claim-data-endpoint/index.js` |
| `Sendero Booking Change` | `kapso/shared-whatsapp-flows/flows/booking-change.flow.json` | `kapso/shared-whatsapp-flows/functions/booking-change-data-endpoint/index.js` |
| `Sendero Accommodation` | `kapso/shared-whatsapp-flows/flows/accommodation.flow.json` | `kapso/shared-whatsapp-flows/functions/accommodation-data-endpoint/index.js` |
| `Sendero Car Transfer` | `kapso/shared-whatsapp-flows/flows/car-transfer.flow.json` | `kapso/shared-whatsapp-flows/functions/car-transfer-data-endpoint/index.js` |
| `Sendero Restaurants Experiences` | `kapso/shared-whatsapp-flows/flows/restaurant-experience.flow.json` | `kapso/shared-whatsapp-flows/functions/restaurant-experience-data-endpoint/index.js` |
| `Sendero NFT Trip Gallery` | `kapso/shared-whatsapp-flows/flows/nft-trip-gallery.flow.json` | `kapso/shared-whatsapp-flows/functions/nft-trip-gallery-data-endpoint/index.js` |
| `Sendero Refund Escrow` | `kapso/shared-whatsapp-flows/flows/refund-escrow.flow.json` | `kapso/shared-whatsapp-flows/functions/refund-escrow-data-endpoint/index.js` |

Security rules for all Flows:

- WhatsApp Flows collect structured intent and can create durable Sendero records.
- Payments, refunds, escrow release/settlement, ticketing, booking commits, policy overrides, wallet transfers, and NFT unlocks must use a narrow secure web/passkey approval link or human approval.
- Prefunded trip claim links must be claimed with a secure code sent to ticket email. Do not ask users to paste that code into WhatsApp.

After publishing or saving the Flow draft, send it to the existing Sendero support WhatsApp number in draft mode first. Use the support agent function env:

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
- `SENDERO_WHATSAPP_FLOW_MODE=draft`

When the Flow opens and submits correctly, switch `SENDERO_WHATSAPP_FLOW_MODE` off or to `published`.

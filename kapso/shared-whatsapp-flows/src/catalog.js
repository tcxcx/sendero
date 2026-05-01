export const WHATSAPP_FLOW_KEYS = {
  loginSignup: 'login_signup',
  tripIntake: 'trip_intake',
  supportIntake: 'support_intake',
  quoteApproval: 'quote_approval',
  ancillaries: 'ancillaries',
  disruptionHelp: 'disruption_help',
  prefundClaim: 'prefund_claim',
  bookingChange: 'booking_change',
  accommodation: 'accommodation',
  carTransfer: 'car_transfer',
  restaurantExperience: 'restaurant_experience',
  nftTripGallery: 'nft_trip_gallery',
  refundEscrow: 'refund_escrow',
};

export const WHATSAPP_FLOW_CATALOG = {
  [WHATSAPP_FLOW_KEYS.loginSignup]: {
    title: 'Login and signup',
    cta: 'Set up account',
    header: 'Sendero account',
    body: 'Create or link your Sendero traveler profile, WhatsApp identity, travel wallet, and trip gallery.',
    footer: 'Wallets and galleries persist across future trips.',
    envVar: 'SENDERO_SUPPORT_LOGIN_SIGNUP_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.tripIntake]: {
    title: 'Trip intake',
    cta: 'Plan trip',
    header: 'Sendero trip intake',
    body: 'Share the core trip details in WhatsApp. I will turn it into a Sendero draft for your travel team.',
    footer: 'No booking or payment is committed from this form.',
    envVar: 'SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.supportIntake]: {
    title: 'Support intake',
    cta: 'Open form',
    header: 'Sendero support',
    body: 'Use this WhatsApp form to classify the support request and capture the details we need.',
    footer: 'Financial, escrow, and refund actions still require human approval.',
    envVar: 'SENDERO_SUPPORT_REQUEST_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.quoteApproval]: {
    title: 'Quote approval',
    cta: 'Review quote',
    header: 'Sendero quote',
    body: 'Review a travel quote and send your decision to the travel team. Payment and ticketing still use a secure approval link.',
    footer: 'No payment or ticketing happens inside WhatsApp.',
    envVar: 'SENDERO_SUPPORT_QUOTE_APPROVAL_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.ancillaries]: {
    title: 'Ancillaries',
    cta: 'Add extras',
    header: 'Trip extras',
    body: 'Request bags, seats, insurance, lounge, meals, or priority boarding for an existing trip.',
    footer: 'Paid extras still require secure approval.',
    envVar: 'SENDERO_SUPPORT_ANCILLARIES_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.disruptionHelp]: {
    title: 'Disruption help',
    cta: 'Get help',
    header: 'Travel disruption',
    body: 'Tell Sendero what changed so the travel team can help with rebooking, refunds, hotels, or transport.',
    footer: 'Urgent disruptions are routed to the operator channel.',
    envVar: 'SENDERO_SUPPORT_DISRUPTION_HELP_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.prefundClaim]: {
    title: 'Prefunded claim',
    cta: 'Claim help',
    header: 'Prefunded trip',
    body: 'Get help claiming a prefunded trip. The secure claim code is sent to ticket email, not WhatsApp.',
    footer: 'Never paste your email claim code into WhatsApp.',
    envVar: 'SENDERO_SUPPORT_PREFUND_CLAIM_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.bookingChange]: {
    title: 'Booking change',
    cta: 'Change booking',
    header: 'Booking change',
    body: 'Request a date, route, rebook, or cancellation change. Fare and refund actions still require secure approval.',
    footer: 'No cancellation or ticketing happens inside WhatsApp.',
    envVar: 'SENDERO_SUPPORT_BOOKING_CHANGE_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.accommodation]: {
    title: 'Accommodation',
    cta: 'Find stay',
    header: 'Accommodation',
    body: 'Share stay dates, rooms, budget, amenities, and loyalty details for your travel team.',
    footer: 'Paid booking still requires approval.',
    envVar: 'SENDERO_SUPPORT_ACCOMMODATION_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.carTransfer]: {
    title: 'Car or transfer',
    cta: 'Book transport',
    header: 'Ground transport',
    body: 'Request airport transfers, point-to-point rides, or car rentals with pickup, dropoff, and passenger details.',
    footer: 'Payment or confirmation still uses secure approval.',
    envVar: 'SENDERO_SUPPORT_CAR_TRANSFER_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.restaurantExperience]: {
    title: 'Restaurants and experiences',
    cta: 'Get ideas',
    header: 'Local recommendations',
    body: 'Capture cuisine, area, budget, time window, dietary needs, or experience preferences.',
    footer: 'Paid reservations need approval.',
    envVar: 'SENDERO_SUPPORT_RESTAURANT_EXPERIENCE_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.nftTripGallery]: {
    title: 'NFT trip gallery',
    cta: 'Open gallery',
    header: 'Trip gallery',
    body: 'View or request help with trip stamps, gallery links, and NFT unlock status.',
    footer: 'Unlocks require verification or secure approval.',
    envVar: 'SENDERO_SUPPORT_NFT_TRIP_GALLERY_FLOW_ID',
  },
  [WHATSAPP_FLOW_KEYS.refundEscrow]: {
    title: 'Refund and escrow',
    cta: 'Open request',
    header: 'Refund or escrow',
    body: 'Capture refund, escrow, settlement, or validation issues for secure human review.',
    footer: 'Refunds and settlements never execute inside WhatsApp.',
    envVar: 'SENDERO_SUPPORT_REFUND_ESCROW_FLOW_ID',
  },
};

export const WHATSAPP_FLOW_AGENT_PROMPT = `
Structured WhatsApp Flows:
- Prefer WhatsApp Flow forms for structured intake when the user wants to sign up or log in over WhatsApp, plan/book a trip, request a quote, change a booking, ask for a refund, or open a support request with multiple fields.
- Flow keys are login_signup, trip_intake, support_intake, quote_approval, ancillaries, disruption_help, prefund_claim, booking_change, accommodation, car_transfer, restaurant_experience, nft_trip_gallery, and refund_escrow.
- Use login_signup when a traveler needs a persistent Sendero profile, wallet, WhatsApp identity binding, traveler profile, or trip gallery before continuing.
- Use quote_approval for quote decisions, ancillaries for paid extras, disruption_help for delays/cancellations/rebooking, prefund_claim for claim-link guidance, booking_change for date/route/cancel/rebook intake, accommodation for hotels, car_transfer for ground transport, restaurant_experience for recommendations, nft_trip_gallery for trip stamps, and refund_escrow for refund/settlement intake.
- Prefunded claim links are claimable only with the secure code delivered to ticket email. Do not ask the user to paste that code into WhatsApp.
- Support and tenant agents can send these Flows when Sendero has a registered Flow id for the active WhatsApp phone number. Tenant agents resolve Flow ids from Sendero at send time; never hardcode tenant Flow ids in Kapso env.
- When a Flow is sent successfully, tell the user to complete the form in WhatsApp and then call enter_waiting.
- If Flow sending is unavailable or unconfigured, continue with concise text intake using the same required fields.`;

export function getFlowCatalogItem(flowKey) {
  return WHATSAPP_FLOW_CATALOG[flowKey] ?? null;
}

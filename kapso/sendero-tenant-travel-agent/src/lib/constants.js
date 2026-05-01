export const DEFAULT_PROVIDER_MODEL_NAME = 'gpt-5-mini';
export const WORKFLOW_NAME = 'Sendero Tenant Travel Agent';

export const FUNCTION_SLUGS = {
  createHandoff: 'sendero-tenant-travel-create-handoff',
  createTripIntake: 'sendero-tenant-travel-create-trip-intake',
  getChannelEvents: 'sendero-tenant-travel-get-channel-events',
  getContext: 'sendero-tenant-travel-get-context',
  getTripContext: 'sendero-tenant-travel-get-trip-context',
  getWalletContext: 'sendero-tenant-travel-get-wallet-context',
  getWhatsappSessionContext: 'sendero-tenant-travel-get-whatsapp-session-context',
  lifecycleTool: 'sendero-tenant-travel-lifecycle-tool',
  requestWhatsappOtp: 'sendero-tenant-travel-request-whatsapp-otp',
  searchDocs: 'sendero-tenant-travel-search-docs',
  sendFlowMessage: 'sendero-tenant-travel-send-flow-message',
  verifyWhatsappOtp: 'sendero-tenant-travel-verify-whatsapp-otp',
};

export const FUNCTION_DESCRIPTIONS = {
  createHandoff:
    'Create a durable Sendero internal web handoff for a tenant operator, optionally fanning out to configured Slack or WhatsApp operator channels.',
  createTripIntake:
    'Create a draft Sendero trip intake from a WhatsApp customer conversation. In sandbox mode this cannot commit bookings or move funds.',
  getChannelEvents:
    'Fetch recent WhatsApp delivery, webhook, and identity events for this tenant channel.',
  getContext:
    'Fetch live tenant, plan, WhatsApp, Slack, handoff, recent trip, and sandbox context for the current WhatsApp conversation.',
  getTripContext:
    'Fetch live trip, traveler, policy, booking, settlement, and timeline context for a tenant trip or customer.',
  getWalletContext:
    'Fetch tenant wallet, gateway, and traveler-wallet context without moving funds.',
  getWhatsappSessionContext:
    'Resolve the remembered or verified WhatsApp session for the current tenant contact and explain allowed action levels.',
  lifecycleTool:
    'Run controlled Sendero trip lifecycle tools for quotes, prefunds, payments, bookings, accommodation, transfers, restaurants, ancillaries, NFT trip gallery, disruption help, refunds, and escrow. Read/search/planning operations may be automatic; payment movement, refunds, escrow settlement, booking commits, wallet transfers, and NFT unlocks still require secure approval or human review.',
  requestWhatsappOtp:
    'Send a short-lived WhatsApp authentication OTP to elevate a remembered WhatsApp session to verified.',
  searchDocs: 'Search Sendero docs and runbooks for product and workflow guidance.',
  sendFlowMessage:
    'Send a registered tenant WhatsApp Flow by Flow key. Resolves the tenant-specific Flow id from Sendero before sending, and falls back cleanly when the tenant has not registered that Flow yet.',
  verifyWhatsappOtp:
    'Verify a WhatsApp authentication OTP and mark the current ChannelIdentity as a verified WhatsApp session.',
};

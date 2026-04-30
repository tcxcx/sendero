export const DEFAULT_PROVIDER_MODEL_NAME = 'gpt-5-mini';
export const WORKFLOW_NAME = 'Sendero Tenant Travel Agent';

export const FUNCTION_SLUGS = {
  createHandoff: 'sendero-tenant-travel-create-handoff',
  createTripIntake: 'sendero-tenant-travel-create-trip-intake',
  getChannelEvents: 'sendero-tenant-travel-get-channel-events',
  getContext: 'sendero-tenant-travel-get-context',
  getTripContext: 'sendero-tenant-travel-get-trip-context',
  getWalletContext: 'sendero-tenant-travel-get-wallet-context',
  searchDocs: 'sendero-tenant-travel-search-docs',
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
  searchDocs: 'Search Sendero docs and runbooks for product and workflow guidance.',
};

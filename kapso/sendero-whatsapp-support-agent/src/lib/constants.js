export const KAPSO_API_BASE_URL = 'https://api.kapso.ai';
export const DEFAULT_PROVIDER_MODEL_NAME = 'gpt-5-mini';
export const WORKFLOW_NAME = 'Sendero WhatsApp Support Agent';

export const FUNCTION_SLUGS = {
  askTeamQuestion: 'sendero-whatsapp-support-ask-team-question',
  createSupportTicket: 'sendero-whatsapp-support-create-support-ticket',
  getBillingContext: 'sendero-whatsapp-support-get-billing-context',
  getEscrowContext: 'sendero-whatsapp-support-get-escrow-context',
  getRecentChannelEvents: 'sendero-whatsapp-support-get-recent-channel-events',
  getTenantContext: 'sendero-whatsapp-support-get-tenant-context',
  getTripContext: 'sendero-whatsapp-support-get-trip-context',
  getWhatsappSetupStatus: 'sendero-whatsapp-support-get-whatsapp-setup-status',
  searchSenderoDocs: 'sendero-whatsapp-support-search-sendero-docs',
  sendFlowMessage: 'sendero-whatsapp-support-send-flow-message',
  slackEvents: 'sendero-whatsapp-support-slack-events',
  updateSupportTicket: 'sendero-whatsapp-support-update-support-ticket',
};

export const FUNCTION_DESCRIPTIONS = {
  askTeamQuestion:
    'Ask the Sendero support team a precise question in Slack when the WhatsApp agent cannot safely resolve a customer issue.',
  createSupportTicket:
    'Create a durable Sendero support ticket linked to tenant, WhatsApp, workflow, and Slack context.',
  getBillingContext:
    'Fetch live billing, subscription, credit meter, invoice, and spend-cap context for a Sendero tenant.',
  getEscrowContext:
    'Fetch live escrow, settlement, transfer, wallet, gateway, and validation context for a Sendero tenant.',
  getRecentChannelEvents:
    'Fetch recent WhatsApp webhook, API, outbound delivery, and identity events for debugging channel issues.',
  getTenantContext: 'Fetch live Sendero tenant, subscription, channel, and recent support context.',
  getTripContext:
    'Fetch live trip, traveler, policy, booking, settlement, and session context for a Sendero trip.',
  getWhatsappSetupStatus:
    'Fetch live WhatsApp install, setup link, phone number, webhook, API, and delivery diagnostics.',
  searchSenderoDocs: 'Search Sendero product docs, runbooks, and WhatsApp templates.',
  sendFlowMessage:
    'Send a configured Sendero WhatsApp Flow form to the current support WhatsApp conversation.',
  updateSupportTicket: 'Update the status or summary of a durable Sendero support ticket.',
};

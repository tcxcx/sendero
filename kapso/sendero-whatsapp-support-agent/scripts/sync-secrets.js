import { FUNCTION_SLUGS, KAPSO_API_BASE_URL } from '../src/lib/constants.js';
import { getRequiredEnv, loadLocalEnv } from '../src/lib/env.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const remoteMapPath = resolve(rootDir, '.kapso', 'remote-map.json');

const APP_TOOL_SECRETS = [
  'KAPSO_WEBHOOK_BASE_URL',
  'KAPSO_WEBHOOK_SECRET',
  'SENDERO_APP_ORIGIN',
  'SUPPORT_TOOLS_SECRET',
];

const SUPPORT_FLOW_SECRETS = [
  'KAPSO_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID',
  'KAPSO_META_BASE_URL',
  'SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID',
  'SENDERO_SUPPORT_REQUEST_FLOW_ID',
  'SENDERO_SUPPORT_LOGIN_SIGNUP_FLOW_ID',
  'SENDERO_SUPPORT_QUOTE_APPROVAL_FLOW_ID',
  'SENDERO_SUPPORT_ANCILLARIES_FLOW_ID',
  'SENDERO_SUPPORT_DISRUPTION_HELP_FLOW_ID',
  'SENDERO_SUPPORT_PREFUND_CLAIM_FLOW_ID',
  'SENDERO_SUPPORT_BOOKING_CHANGE_FLOW_ID',
  'SENDERO_SUPPORT_ACCOMMODATION_FLOW_ID',
  'SENDERO_SUPPORT_CAR_TRANSFER_FLOW_ID',
  'SENDERO_SUPPORT_RESTAURANT_EXPERIENCE_FLOW_ID',
  'SENDERO_SUPPORT_NFT_TRIP_GALLERY_FLOW_ID',
  'SENDERO_SUPPORT_REFUND_ESCROW_FLOW_ID',
  'SENDERO_WHATSAPP_FLOW_MODE',
];

const FUNCTION_SECRETS = {
  [FUNCTION_SLUGS.askTeamQuestion]: [
    'SLACK_BOT_TOKEN',
    'SLACK_CHANNEL_ID',
    'SLACK_ESCALATION_ASSIGNEE_ID',
    'SUPPORT_ESCALATION_ASSIGNEE_EMAIL',
    'SUPPORT_ESCALATION_ASSIGNEE_NAME',
    ...APP_TOOL_SECRETS,
  ],
  [FUNCTION_SLUGS.createSupportTicket]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getBillingContext]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getEscrowContext]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getRecentChannelEvents]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getTenantContext]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getTripContext]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.getWhatsappSetupStatus]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.searchSenderoDocs]: APP_TOOL_SECRETS,
  [FUNCTION_SLUGS.sendFlowMessage]: SUPPORT_FLOW_SECRETS,
  [FUNCTION_SLUGS.slackEvents]: [
    'KAPSO_API_KEY',
    'SLACK_BOT_TOKEN',
    'SLACK_CHANNEL_ID',
    'SLACK_SIGNING_SECRET',
    'SLACK_VERIFICATION_TOKEN',
  ],
  [FUNCTION_SLUGS.updateSupportTicket]: APP_TOOL_SECRETS,
};

class KapsoApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'KapsoApiError';
    this.status = status;
    this.details = details;
  }
}

function buildUrl(path) {
  return new URL(path, KAPSO_API_BASE_URL).toString();
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapData(value) {
  if (value && typeof value === 'object' && 'data' in value) return value.data;
  return value;
}

async function request(apiKey, path, options = {}) {
  const response = await fetch(buildUrl(path), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new KapsoApiError(
      `Kapso API request failed: ${options.method ?? 'GET'} ${path}`,
      response.status,
      body
    );
  }
  return unwrapData(body);
}

async function readRemoteMap() {
  try {
    return JSON.parse(await readFile(remoteMapPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(
        'Missing .kapso/remote-map.json. Run `bun run kapso -- pull` or `bun run kapso -- push` first.'
      );
    }
    throw error;
  }
}

async function listRemoteFunctions(apiKey) {
  const data = await request(apiKey, '/platform/v1/functions?limit=100');
  return Array.isArray(data) ? data : [];
}

async function functionIdForSlug(apiKey, remoteMap, slug, remoteFunctionsBySlug) {
  const id = remoteMap.functions?.[slug]?.id;
  if (id) return id;
  if (!remoteFunctionsBySlug.size) {
    for (const item of await listRemoteFunctions(apiKey)) {
      if (item?.slug && item?.id) remoteFunctionsBySlug.set(item.slug, item.id);
    }
  }
  const discoveredId = remoteFunctionsBySlug.get(slug);
  if (!discoveredId) {
    throw new Error(
      `Missing remote function mapping for "${slug}". Run \`bun run kapso -- push\` first.`
    );
  }
  console.log(`Discovered ${slug} from Kapso API because .kapso/remote-map.json is stale.`);
  return discoveredId;
}

loadLocalEnv(resolve(rootDir, '..', '..'));
loadLocalEnv(rootDir);

const apiKey = getRequiredEnv('KAPSO_API_KEY');
const remoteMap = await readRemoteMap();
const remoteFunctionsBySlug = new Map();

for (const [slug, secretNames] of Object.entries(FUNCTION_SECRETS)) {
  const functionId = await functionIdForSlug(apiKey, remoteMap, slug, remoteFunctionsBySlug);
  for (const secretName of secretNames) {
    const value = process.env[secretName]?.trim();
    if (!value) {
      if (secretName === 'SLACK_ESCALATION_ASSIGNEE_ID') {
        console.log(`Skipped optional ${secretName} for ${slug}`);
        continue;
      }
      if (secretName.startsWith('SUPPORT_ESCALATION_ASSIGNEE_')) {
        console.log(`Skipped optional ${secretName} for ${slug}`);
        continue;
      }
      if (secretName === 'SENDERO_APP_ORIGIN' || secretName === 'SUPPORT_TOOLS_SECRET') {
        console.log(`Skipped optional ${secretName} for ${slug}`);
        continue;
      }
      if (
        secretName === 'KAPSO_META_BASE_URL' ||
        secretName === 'SENDERO_WHATSAPP_FLOW_MODE' ||
        secretName.startsWith('SENDERO_SUPPORT_')
      ) {
        console.log(`Skipped optional ${secretName} for ${slug}`);
        continue;
      }
    }
    await request(apiKey, `/platform/v1/functions/${functionId}/secrets`, {
      method: 'POST',
      body: {
        secret: {
          name: secretName,
          value: value ?? getRequiredEnv(secretName),
        },
      },
    });
    console.log(`Synced ${secretName} for ${slug}`);
  }
}

const slackEventsFunction = await request(
  apiKey,
  `/platform/v1/functions/${await functionIdForSlug(
    apiKey,
    remoteMap,
    FUNCTION_SLUGS.slackEvents,
    remoteFunctionsBySlug
  )}`
);

if (slackEventsFunction?.endpoint_url) {
  console.log(`Slack events URL: ${slackEventsFunction.endpoint_url}`);
}

/**
 * GET /dashboard/channels/slack/manifest
 *
 * Returns a Slack-app manifest YAML the tenant pastes into Slack's
 * `https://api.slack.com/apps?new_app=1` "From a manifest" flow. Saves
 * ~7 minutes of clicking through the Slack dashboard manually and
 * eliminates the most common scope-mis-config bug — the ~25-minute
 * TTHW for a fresh Slack app drops to ~8 with this baked manifest.
 *
 * The manifest is keyed off the production webhook URLs and the
 * canonical `DEFAULT_BOT_SCOPES` from `@sendero/slack`. Any scope or
 * event-subscription change in code propagates here automatically.
 *
 * Security: this is a tenant-side admin tool, gated by Clerk session.
 * The manifest itself contains no secrets — just the public endpoint
 * URLs and the scope list. Slack still requires the operator to paste
 * + approve it in their own dashboard.
 */

import { auth } from '@clerk/nextjs/server';
import { DEFAULT_BOT_SCOPES } from '@sendero/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);

export async function GET() {
  const session = await auth();
  if (!session.orgId) {
    return new Response('unauthorized', { status: 401 });
  }

  const yaml = renderSlackManifestYaml({
    displayName: 'Sendero',
    description: 'Sendero AI Travel Agent — corporate travel concierge',
    backgroundColor: '#e65632',
    eventsUrl: `${APP_BASE_URL}/api/webhooks/slack/events`,
    interactionsUrl: `${APP_BASE_URL}/api/webhooks/slack/interactions`,
    redirectUri: `${APP_BASE_URL}/api/webhooks/slack/oauth-callback`,
    scopes: DEFAULT_BOT_SCOPES,
    botEvents: [
      'app_mention',
      'message.im',
      'message.channels',
      // Lifecycle — needed so we mark `SlackInstall.revokedAt` and
      // stop hitting a dead bot token. Both events fire workspace-wide
      // (not channel-scoped), no extra scopes required.
      'tokens_revoked',
      'app_uninstalled',
    ],
  });

  return new Response(yaml, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-yaml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sendero-slack-app-manifest.yaml"',
      'Cache-Control': 'private, no-store',
    },
  });
}

interface ManifestInput {
  displayName: string;
  description: string;
  backgroundColor: string;
  eventsUrl: string;
  interactionsUrl: string;
  redirectUri: string;
  scopes: readonly string[];
  botEvents: readonly string[];
}

function renderSlackManifestYaml(input: ManifestInput): string {
  // Slack's manifest spec: https://api.slack.com/reference/manifests
  //
  // Block-style YAML — readable by humans, accepted by Slack's
  // "From a manifest" import. We hand-roll the YAML to keep the build
  // graph free of a YAML serializer dependency for this single use case.
  const lines: string[] = [
    'display_information:',
    `  name: ${yamlString(input.displayName)}`,
    `  description: ${yamlString(input.description)}`,
    `  background_color: ${yamlString(input.backgroundColor)}`,
    'features:',
    '  bot_user:',
    `    display_name: ${yamlString(input.displayName)}`,
    '    always_online: true',
    'oauth_config:',
    '  redirect_urls:',
    `    - ${yamlString(input.redirectUri)}`,
    '  scopes:',
    '    bot:',
    ...input.scopes.map(s => `      - ${yamlString(s)}`),
    'settings:',
    '  event_subscriptions:',
    `    request_url: ${yamlString(input.eventsUrl)}`,
    '    bot_events:',
    ...input.botEvents.map(e => `      - ${yamlString(e)}`),
    '  interactivity:',
    '    is_enabled: true',
    `    request_url: ${yamlString(input.interactionsUrl)}`,
    '  org_deploy_enabled: false',
    '  socket_mode_enabled: false',
    '  token_rotation_enabled: false',
    '',
  ];
  return lines.join('\n');
}

function yamlString(s: string): string {
  // Quote anything that isn't a plain scalar so Slack's YAML parser
  // never has to guess. Escape inner double-quotes + backslashes.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

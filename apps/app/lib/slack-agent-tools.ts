/**
 * Slack tool surface for the Sendero agent (vercel/slack-tools wrapper).
 *
 * `createSlackTools(token)` (from the npm package) returns 12 tools, but
 * 4 of them (`slack_search_*`) require a USER token (`xoxp-…`). Sendero's
 * OAuth flow only requests bot scopes, so the bot token (`xoxb-…`) we
 * persist on `SlackInstall.botToken` cannot drive those endpoints.
 *
 * TODO(slack): if/when we add user-token scopes (`search:read`, `users:read`,
 * `channels:read` on the user side) and store an `authedUserToken`, drop the
 * filter below and pass `install.userToken` to a second `createSlackTools()`
 * invocation. Until then we strip them out so the LLM never gets a tool
 * it can't actually call.
 *
 * Tools we keep (3):
 *   slack_read_channel       slack_read_thread
 *   slack_read_user_profile
 *
 * Tools we strip (4):
 *   slack_search_public           slack_search_public_and_private
 *   slack_search_channels         slack_search_users
 *
 * Approval gating: write tools are intentionally not exposed until the
 * Slack approval-resume path is fully wired. The channel adapter already
 * posts the final reply into the originating thread, so write tools are
 * not needed for normal traveler chat and can create dead-end approval
 * pauses when the model selects them.
 */

import type { SlackInstall } from '@sendero/slack';
import type { Tool } from 'ai';
import { createSlackTools } from 'slack-tools';

/** Tools we surface to the agent — bot-token-only subset. */
export const KEPT_SLACK_TOOLS = [
  'slack_read_channel',
  'slack_read_thread',
  'slack_read_user_profile',
] as const;

export type KeptSlackToolName = (typeof KEPT_SLACK_TOOLS)[number];

/** Write tools that stay hidden until Slack approval resume is implemented. */
export const MUTATING_SLACK_TOOLS = [
  'slack_send_message',
  'slack_schedule_message',
  'slack_create_canvas',
  'slack_join_channel',
  'slack_delete_message',
] as const;

/**
 * Tools requiring a user OAuth token (`xoxp-…`). We don't request the
 * matching `user_scope` set, so these are stripped before the LLM sees
 * the registry.
 */
const USER_TOKEN_ONLY_TOOLS = new Set([
  'slack_search_public',
  'slack_search_public_and_private',
  'slack_search_channels',
  'slack_search_users',
]);

/**
 * Build the per-tenant Slack tool object the agent passes to the AI SDK.
 *
 * Each call instantiates a fresh `WebClient` bound to that tenant's
 * `botToken`, so two parallel turns from different tenants can never
 * cross wires.
 */
export function senderoSlackTools(install: Pick<SlackInstall, 'botToken'>): Record<string, Tool> {
  const all = createSlackTools(install.botToken) as Record<string, Tool>;

  const kept: Record<string, Tool> = {};
  for (const name of KEPT_SLACK_TOOLS) {
    const t = all[name];
    if (t) kept[name] = t;
  }
  for (const mutating of MUTATING_SLACK_TOOLS) {
    delete kept[mutating];
  }
  // Defensive: never let a user-token tool slip through, even if a future
  // slack-tools version restructures its return shape.
  for (const stripped of USER_TOKEN_ONLY_TOOLS) {
    delete kept[stripped];
  }
  return kept;
}

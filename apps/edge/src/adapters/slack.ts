/**
 * Slack slash-command + events webhook adapter.
 *
 * Shell for the hackathon — parses the slash command payload, routes
 * intent to a tool from @sendero/tools, replies with a Slack
 * response_url message. Request-signature verification stubbed pending
 * a real Slack app.
 *
 * Env:
 *   SLACK_SIGNING_SECRET — verification secret
 *   SLACK_BOT_TOKEN      — `xoxb-…` for posting messages
 */

import type { Hono } from 'hono';
import { routeToAgent } from '@sendero/tools/agent';

interface SlashCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

async function inferReply(text: string, slackUser: { id: string; name: string }): Promise<string> {
  if (!text.trim()) {
    return 'Sendero · try `/sendero <prompt>`. E.g. `/sendero book SFO→LHR May 10 premium economy`.';
  }
  const result = await routeToAgent(text, {
    ctx: { traveler: { name: slackUser.name } },
    maxSteps: 5,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[slack] ${result.provider} · ${result.steps} steps · tools=[${result.toolsCalled.join(',')}]`
  );
  return result.text;
}

export function mountSlack(app: Hono): void {
  app.post('/slack', async c => {
    // Slack sends application/x-www-form-urlencoded for slash commands.
    const raw = await c.req.text();
    const params = new URLSearchParams(raw);
    const payload = Object.fromEntries(params.entries()) as unknown as SlashCommandPayload;

    // Slack expects a 200 within 3s. Acknowledge immediately, post
    // follow-ups to response_url.
    const ackText = 'Working on it…';
    const ack = { response_type: 'ephemeral', text: ackText };

    if (payload.response_url) {
      const slackUser = {
        id: payload.user_id ?? 'unknown',
        name: payload.user_name ?? 'traveler',
      };
      // Fire the real reply asynchronously — don't block the ack.
      inferReply(payload.text ?? '', slackUser).then(async reply => {
        try {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'in_channel',
              text: reply,
            }),
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[slack] response_url post failed:', err);
        }
      });
    }

    return c.json(ack);
  });
}

/**
 * WhatsApp send orchestrator.
 *
 * Composes the canonical channel-render layer with the @sendero/whatsapp
 * client. Callers pass a `ChannelMessage` + recipient phone (E.164);
 * this module renders via `renderForWhatsApp`, instantiates a
 * `WhatsAppClient` from the install's credentials, stamps the recipient
 * onto the rendered payload, and forwards via `WhatsAppClient.send`.
 *
 * Dependency direction matches the Slack orchestrator: apps/app composes
 * the package primitive, the package never imports back. Keeps the
 * workspace cycle-free.
 *
 * Returns `{ sent: false, reason }` when the canonical kind is
 * intentionally not relayed to WhatsApp (operator approval cards, raw
 * tool_invocation, reasoning, empty sources). Otherwise returns the
 * Cloud API send response.
 */

import type { WhatsAppInstall } from '@prisma/client';
import { WhatsAppClient } from '@sendero/whatsapp';
import { env } from '@sendero/env';
import { renderForWhatsApp } from '@/lib/channel-render';
import type { ChannelMessage } from '@/lib/channel-render';

export interface SendWhatsAppArgs {
  install: WhatsAppInstall;
  /** Recipient phone in E.164 (e.g. `+15551234567`). */
  recipient: string;
  message: ChannelMessage;
  /**
   * Override credentials when the install row stores the Kapso connection
   * id but not the Meta access token (Kapso-mediated installs). When
   * unset, falls back to the global `WHATSAPP_ACCESS_TOKEN` env.
   */
  accessToken?: string;
}

export type SendWhatsAppResult =
  | { sent: false; reason: string }
  | { sent: true; response: unknown; degraded?: boolean };

export async function sendChannelMessageWhatsApp(
  args: SendWhatsAppArgs
): Promise<SendWhatsAppResult> {
  const rendered = await renderForWhatsApp(args.message);
  if (!rendered) {
    return { sent: false, reason: 'kind-not-relayed-to-whatsapp' };
  }

  if (!args.install.phoneNumberId) {
    return { sent: false, reason: 'install-missing-phone-number-id' };
  }

  const accessToken = args.accessToken ?? env.whatsappAccessToken();
  if (!accessToken) {
    return { sent: false, reason: 'access-token-unavailable' };
  }

  const client = new WhatsAppClient({
    phoneNumberId: args.install.phoneNumberId,
    accessToken,
    apiBaseUrl: env.whatsappApiBaseUrl() ?? undefined,
  });

  // Stamp the recipient onto the rendered payload. The renderer leaves
  // `to` as an empty string by design so a single rendered payload can
  // be cached and dispatched to multiple recipients without re-render.
  const payload = { ...rendered.payload, to: args.recipient };
  const response = await client.send(payload);

  return { sent: true, response, degraded: rendered.degraded };
}

import { env } from '@sendero/env';
import {
  type ApplicationOut,
  AppPortalCapability,
  type MessageOut,
  Svix,
  type SvixOptions,
} from 'svix';

export type SenderoWebhookEventType =
  | 'trip.created'
  | 'trip.updated'
  | 'invoice.created'
  | 'invoice.paid'
  | 'wallet.provisioned'
  | 'booking.ticketed'
  | 'booking.failed'
  | (string & {});

export type SenderoSvixClientOptions = SvixOptions & {
  token?: string | null;
};

export interface TenantWebhookApplicationInput {
  tenantId: string;
  tenantName?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  client?: Svix;
  idempotencyKey?: string;
}

export interface PublishTenantWebhookInput extends TenantWebhookApplicationInput {
  eventType: SenderoWebhookEventType;
  payload: unknown;
  eventId?: string;
  tags?: string[];
  channels?: string[];
}

export interface TenantWebhookPortalInput extends TenantWebhookApplicationInput {
  readOnly?: boolean;
  expirySeconds?: number;
}

export interface TenantWebhookPortal {
  application: ApplicationOut;
  token: string;
  url: string;
}

export function createSvixClient(options: SenderoSvixClientOptions = {}): Svix | null {
  const { token = env.svixToken(), ...svixOptions } = options;
  if (!token) {
    return null;
  }
  return new Svix(token, {
    serverUrl: env.svixServerUrl(),
    ...svixOptions,
  });
}

export function requireSvixClient(options: SenderoSvixClientOptions = {}): Svix {
  const client = createSvixClient(options);
  if (!client) {
    throw new Error('SVIX_TOKEN is not configured');
  }
  return client;
}

export function tenantWebhookApplicationUid(tenantId: string): string {
  return `tenant_${tenantId}`;
}

export async function ensureTenantWebhookApplication(
  input: TenantWebhookApplicationInput
): Promise<ApplicationOut> {
  const client = input.client ?? requireSvixClient();
  const uid = tenantWebhookApplicationUid(input.tenantId);

  return client.application.getOrCreate(
    {
      uid,
      name: input.tenantName ? `Sendero - ${input.tenantName}` : `Sendero tenant ${input.tenantId}`,
      metadata: stringifyMetadata({ tenantId: input.tenantId, ...input.metadata }),
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
  );
}

export async function publishTenantWebhook(
  input: PublishTenantWebhookInput
): Promise<{ application: ApplicationOut; message: MessageOut }> {
  const client = input.client ?? requireSvixClient();
  const application = await ensureTenantWebhookApplication({ ...input, client });

  const message = await client.message.create(
    application.id,
    {
      eventType: input.eventType,
      payload: input.payload,
      eventId: input.eventId,
      tags: input.tags,
      channels: input.channels,
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
  );

  return { application, message };
}

export async function createTenantWebhookPortal(
  input: TenantWebhookPortalInput
): Promise<TenantWebhookPortal> {
  const client = input.client ?? requireSvixClient();
  const application = await ensureTenantWebhookApplication({ ...input, client });

  const portal = await client.authentication.appPortalAccess(application.id, {
    readOnly: input.readOnly ?? false,
    expiry: input.expirySeconds ?? 60 * 60,
    capabilities: input.readOnly
      ? [AppPortalCapability.ViewBase, AppPortalCapability.ViewEndpointSecret]
      : [
          AppPortalCapability.ViewBase,
          AppPortalCapability.ViewEndpointSecret,
          AppPortalCapability.ManageEndpoint,
          AppPortalCapability.ManageEndpointSecret,
        ],
  });

  return { application, token: portal.token, url: portal.url };
}

function stringifyMetadata(
  metadata: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(
        (entry): entry is [string, string | number | boolean] =>
          entry[1] !== null && entry[1] !== undefined
      )
      .map(([key, value]) => [key, String(value)])
  );
}

# Sendero Webhooks

Sendero uses two webhook paths:

1. Inbound provider webhooks into Sendero, such as Clerk and Duffel.
2. Outbound/customer webhooks from Sendero to tenant systems, delivered by Svix.

This follows the next-forge split: provider-specific signing secrets remain on the inbound routes, while `SVIX_TOKEN` enables the optional Svix customer webhook service.

## Environment

```bash
# Inbound provider verification
CLERK_WEBHOOK_SECRET=whsec_...
DUFFEL_WEBHOOK_SECRET=...

# Outbound/customer webhook delivery
SVIX_TOKEN=...
```

`SVIX_TOKEN` is optional for local QA unless you are creating a tenant webhook portal link or publishing Sendero events through Svix.

## Local Provider URLs

Start the Sendero ngrok tunnel:

```bash
bun run webhooks:ngrok
bun run webhooks:urls
```

Current local dev endpoints:

```text
Clerk:  https://sendero-dev-bufi.ngrok.app/api/webhooks/clerk
Duffel: https://sendero-dev-bufi.ngrok.app/api/webhooks/duffel
```

Keep the Sendero ngrok domain separate from desk-v1 tunnels so both products can receive webhooks at the same time.

## Inbound Provider Pattern

Every provider route should:

1. Read the raw request body.
2. Verify the provider signature before parsing or trusting payload fields.
3. Normalize the event into `{ provider, externalId, eventType, payload }`.
4. Call `processDurableWebhook` from `@sendero/webhooks/inbound`.
5. Return 500 only for retryable dispatch failures.

Example:

```ts
import { processDurableWebhook } from '@sendero/webhooks/inbound';
import { webhookEventStore } from '@/lib/webhook-events';

const result = await processDurableWebhook({
  provider: 'provider-name',
  externalId: event.id,
  eventType: event.type,
  payload: event.raw,
  event,
  store: webhookEventStore,
  dispatch: async verifiedEvent => {
    // Provider-specific side effects here.
  },
  logger: console,
  logPrefix: '[webhooks/provider-name]',
});
```

The `webhook_events` table dedupes by `(provider, externalId)`. Successful deliveries set `processedAt`. Failed dispatches store `processingError` but leave `processedAt` null so provider retries can run the handler again.

## Outbound Customer Webhooks

Use `@sendero/webhooks/svix` when Sendero needs to expose tenant events to customers.

```ts
import {
  createTenantWebhookPortal,
  publishTenantWebhook,
} from '@sendero/webhooks/svix';

const portal = await createTenantWebhookPortal({
  tenantId,
  tenantName,
});

await publishTenantWebhook({
  tenantId,
  tenantName,
  eventType: 'invoice.created',
  eventId: invoice.id,
  payload: { invoiceId: invoice.id },
});
```

Svix application UIDs are deterministic: `tenant_<tenantId>`. Reusing the same tenant id gives the tenant a stable webhook app and portal across deploys.

## Adding a Provider

1. Add the provider signing secret to `.env.example`, `packages/env/src/index.ts`, and `turbo.json`.
2. Implement signature verification in the provider package or route module.
3. Add an `apps/app/app/api/webhooks/<provider>/route.ts` route using `processDurableWebhook`.
4. Add provider-specific dispatch tests and a smoke command if the provider supports local signing.
5. Add the provider URL to `scripts/show-sendero-webhook-urls.sh`.

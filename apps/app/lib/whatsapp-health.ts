import { env } from '@sendero/env';
import { KapsoClient } from '@sendero/kapso';

export type WhatsAppHealthSummary = {
  status: string | null;
  messagingStatus: string | null;
  phoneStatus: string | null;
  webhookSubscribed: boolean | null;
  webhookVerified: boolean | null;
  qualityRating: string | null;
  errors: string[];
  checkedAt: string;
};

export async function readWhatsappHealth(
  phoneNumberId: string
): Promise<WhatsAppHealthSummary | null> {
  const apiKey = env.kapsoApiKey();
  if (!apiKey) return null;
  try {
    const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
    const health = (await kapso.checkPhoneHealth(phoneNumberId)) as Record<string, unknown>;
    return summarizeWhatsappHealth(health);
  } catch (err) {
    return {
      status: 'error',
      messagingStatus: null,
      phoneStatus: null,
      webhookSubscribed: null,
      webhookVerified: null,
      qualityRating: null,
      errors: [err instanceof Error ? err.message : String(err)],
      checkedAt: new Date().toISOString(),
    };
  }
}

export function summarizeWhatsappHealth(health: Record<string, unknown>): WhatsAppHealthSummary {
  const checks = readRecord(health.checks);
  const phoneNumberAccess = readRecord(readRecord(checks.phone_number_access).details);
  const messagingHealth = readRecord(checks.messaging_health);
  const webhookSubscription = readRecord(checks.webhook_subscription);
  const webhookVerified = readRecord(checks.webhook_verified);
  const errors: string[] = [];
  const entities = readRecord(messagingHealth.details).entities;
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      const record = readRecord(entity);
      const entityErrors = record.errors;
      if (!Array.isArray(entityErrors)) continue;
      for (const item of entityErrors) {
        const error = readRecord(item);
        const description =
          typeof error.error_description === 'string' ? error.error_description : null;
        const solution =
          typeof error.possible_solution === 'string' ? error.possible_solution : null;
        if (description) errors.push(solution ? `${description} ${solution}` : description);
      }
    }
  }
  return {
    status: typeof health.status === 'string' ? health.status : null,
    messagingStatus:
      typeof messagingHealth.overall_status === 'string' ? messagingHealth.overall_status : null,
    phoneStatus: typeof phoneNumberAccess.status === 'string' ? phoneNumberAccess.status : null,
    webhookSubscribed:
      typeof webhookSubscription.passed === 'boolean' ? webhookSubscription.passed : null,
    webhookVerified: typeof webhookVerified.passed === 'boolean' ? webhookVerified.passed : null,
    qualityRating:
      typeof phoneNumberAccess.quality_rating === 'string'
        ? phoneNumberAccess.quality_rating
        : null,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

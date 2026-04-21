const DEFAULT_APP_URL = 'https://sendero.travel';

function normalizeBaseUrl(baseUrl?: string | null): string {
  const candidate = (baseUrl ?? '').trim();
  if (!candidate) return DEFAULT_APP_URL;
  try {
    const parsed = new URL(candidate);
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return DEFAULT_APP_URL;
  }
}

export function buildPublicInvoiceUrl(token: string, baseUrl?: string | null): string {
  const safeToken = String(token ?? '').trim();
  const origin = normalizeBaseUrl(baseUrl);
  return `${origin}/invoice/${encodeURIComponent(safeToken)}`;
}

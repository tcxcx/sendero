/**
 * @sendero/web-search/client — env helpers + enable check.
 *
 * CSE is enabled when both `GOOGLE_API_KEY` (or `GOOGLE_CUSTOM_SEARCH_API_KEY`)
 * AND `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` are set. Single GCP project, single
 * key with Custom Search API enabled.
 */

export function isCseEnabled(): boolean {
  const explicit = process.env.WEB_SEARCH_ENABLED;
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  return !!(getCseApiKey() && getCseEngineId());
}

/**
 * Resolve the CSE API key. Prefers the dedicated
 * `GOOGLE_CUSTOM_SEARCH_API_KEY` if set (some teams isolate CSE quota
 * on a separate key for billing observability); falls back to
 * `GOOGLE_API_KEY`.
 */
export function getCseApiKey(): string | undefined {
  return process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export function getCseEngineId(): string | undefined {
  return process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || undefined;
}

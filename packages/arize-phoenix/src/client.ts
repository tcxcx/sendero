/**
 * @sendero/arize-phoenix/client — env helpers + enable check.
 *
 * Phoenix is enabled when PHOENIX_API_KEY is set (and optionally
 * PHOENIX_ENABLED=false to force off). Cloud is the default; self-host
 * via PHOENIX_COLLECTOR_ENDPOINT pointing at a docker-compose instance.
 */

export function isPhoenixEnabled(): boolean {
  const explicit = process.env.PHOENIX_ENABLED;
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  return !!process.env.PHOENIX_API_KEY;
}

/**
 * Phoenix collector endpoint base — workspace-scoped on Cloud, plain
 * host on self-host. Exporter appends `/v1/traces` (OTLP HTTP).
 */
export function getPhoenixCollectorEndpoint(): string {
  return (
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_BASE_URL ||
    'https://app.phoenix.arize.com'
  );
}

export function getPhoenixApiKey(): string | undefined {
  return process.env.PHOENIX_API_KEY || undefined;
}

export function getPhoenixProjectName(): string {
  return process.env.PHOENIX_PROJECT_NAME || 'sendero';
}

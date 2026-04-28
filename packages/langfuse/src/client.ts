/**
 * @sendero/langfuse/client — Lazy-initialized LangfuseClient singleton
 *
 * Used for REST operations: scores, prompts, datasets.
 * Lazy-loaded to avoid startup cost in edge runtimes or when Langfuse is not configured.
 */

type LangfuseClientType = import('@langfuse/client').LangfuseClient;

let _client: LangfuseClientType | null = null;
let _clientInitAttempted = false;

export function isLangfuseEnabled(): boolean {
  const explicit = process.env.LANGFUSE_ENABLED;
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY);
}

export function isLangfusePromptManagementEnabled(): boolean {
  return process.env.LANGFUSE_PROMPT_MANAGEMENT === 'true';
}

export function isLangfuseEvaluatorsEnabled(): boolean {
  return process.env.LANGFUSE_EVALUATORS === 'true';
}

export function getLangfuseBaseUrl(): string | undefined {
  return process.env.LANGFUSE_BASE_URL || undefined;
}

export function getClient(): LangfuseClientType | null {
  if (_clientInitAttempted) return _client;
  _clientInitAttempted = true;

  if (!isLangfuseEnabled()) return null;

  try {
    const { LangfuseClient } = require('@langfuse/client') as typeof import('@langfuse/client');

    _client = new LangfuseClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: getLangfuseBaseUrl(),
    });
  } catch (err) {
    console.warn(
      '[langfuse] Failed to initialize client:',
      err instanceof Error ? err.message : err
    );
  }

  return _client;
}

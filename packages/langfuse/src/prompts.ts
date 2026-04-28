/**
 * @sendero/langfuse/prompts — Langfuse Prompt Management
 *
 * Fetch versioned prompts from Langfuse with 60s cache + hardcoded fallback.
 * When LANGFUSE_PROMPT_MANAGEMENT=true prompts are pulled from the Langfuse UI;
 * otherwise the hardcoded fallback is returned immediately with zero network calls.
 *
 * Usage:
 *   const { text } = await getPromptWithFallback('sendero-system', FALLBACK, { locale });
 *
 * Prompt name convention: sendero-{service}
 */

import { getClient, isLangfusePromptManagementEnabled } from './client';

interface PromptOptions {
  version?: number;
  label?: string;
  cacheTtlSeconds?: number;
}

export interface LangfusePromptResult {
  text: string;
  name: string;
  version: number;
  /** Pass to aiTelemetryConfig metadata for trace → prompt version linkage. */
  linkMetadata: { promptName: string; promptVersion: string };
}

/**
 * Fetch a prompt from Langfuse with a hardcoded fallback.
 * Safe to call anywhere — returns the fallback if Langfuse is down or unconfigured.
 */
export async function getPromptWithFallback(
  name: string,
  fallback: string,
  variables?: Record<string, string>,
  options?: PromptOptions
): Promise<LangfusePromptResult> {
  const client = getClient();
  if (!client || !isLangfusePromptManagementEnabled()) {
    return {
      text: substituteVariables(fallback, variables),
      name,
      version: 0,
      linkMetadata: { promptName: name, promptVersion: 'fallback' },
    };
  }

  try {
    const prompt = await client.prompt.get(name, {
      version: options?.version,
      label: options?.label,
      cacheTtlSeconds: options?.cacheTtlSeconds ?? 60,
    });

    const compiled = compilePrompt(prompt, variables);

    return {
      text: compiled,
      name: prompt.name,
      version: prompt.version,
      linkMetadata: {
        promptName: prompt.name,
        promptVersion: String(prompt.version),
      },
    };
  } catch (err) {
    console.warn('[langfuse] Failed to fetch prompt, using fallback:', {
      name,
      error: err instanceof Error ? err.message : err,
    });

    return {
      text: substituteVariables(fallback, variables),
      name,
      version: 0,
      linkMetadata: { promptName: name, promptVersion: 'fallback' },
    };
  }
}

/** Fetch raw prompt object for advanced use cases. Returns null if unavailable. */
export async function getPromptRaw(name: string, options?: PromptOptions) {
  const client = getClient();
  if (!client || !isLangfusePromptManagementEnabled()) return null;

  try {
    return await client.prompt.get(name, {
      version: options?.version,
      label: options?.label,
      cacheTtlSeconds: options?.cacheTtlSeconds ?? 60,
    });
  } catch (err) {
    console.warn('[langfuse] Failed to fetch raw prompt:', {
      name,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

/** Compile a Langfuse prompt with variable substitution. */
export function compilePrompt(
  prompt: { compile: (vars?: Record<string, string>) => string },
  variables?: Record<string, string>
): string {
  return variables ? prompt.compile(variables) : prompt.compile();
}

function substituteVariables(template: string, variables?: Record<string, string>): string {
  if (!variables) return template;
  return Object.entries(variables).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template
  );
}

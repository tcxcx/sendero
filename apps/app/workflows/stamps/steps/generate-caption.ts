/**
 * Generate the OG description / collection-grid hover caption.
 *
 * Picks a credentialed text model in priority order:
 *
 *   1. **Vercel AI Gateway** with GPT-5-nano (`openai/gpt-5-nano`) —
 *      the consolidated billing path.
 *   2. **Vertex AI direct** with `gemini-2.5-flash-lite` — same GCP
 *      auth shape as the image step.
 *   3. **AI Studio direct** with `gemini-2.5-flash-lite`.
 *   4. **Anthropic direct** with `claude-haiku-4-5` — last-resort
 *      so a single missing Google credential doesn't break the
 *      whole stamp pipeline.
 *
 * One short line, ≤140 chars (Slack ~150 / WhatsApp ~160 before
 * truncation). Strips quote/wrap garbage so OG previews stay clean.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { type LanguageModel, generateText } from 'ai';

interface PickedTextProvider {
  provider: 'gateway' | 'vertex' | 'google' | 'anthropic';
  model: LanguageModel;
}

function pickTextProvider(): PickedTextProvider | null {
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    return { provider: 'gateway', model: 'openai/gpt-5-nano' };
  }
  const vertexProject =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_VERTEX_PROJECT;
  if (vertexProject) {
    let googleAuthOptions: Parameters<typeof createVertex>[0]['googleAuthOptions'];
    const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (saJson) {
      try {
        googleAuthOptions = { credentials: JSON.parse(saJson) };
      } catch {
        googleAuthOptions = undefined;
      }
    }
    if (saJson === undefined || googleAuthOptions !== undefined) {
      const vertex = createVertex({
        project: vertexProject,
        location:
          process.env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1',
        googleAuthOptions,
      });
      return { provider: 'vertex', model: vertex('gemini-2.5-flash-lite') };
    }
  }
  const directKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (directKey) {
    const google = createGoogleGenerativeAI({ apiKey: directKey });
    return { provider: 'google', model: google('gemini-2.5-flash-lite') };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return { provider: 'anthropic', model: anthropic('claude-haiku-4-5') };
  }
  return null;
}

export const generateStampCaption = async (prompt: string): Promise<string> => {
  'use step';

  const picked = pickTextProvider();
  if (!picked) {
    throw new Error(
      'No text-model credentials for the stamp caption. Set AI_GATEWAY_API_KEY (preferred), or any of GOOGLE_CLOUD_PROJECT (+ADC) / GOOGLE_GENERATIVE_AI_API_KEY / ANTHROPIC_API_KEY.'
    );
  }

  const { text } = await generateText({
    model: picked.model,
    prompt,
    maxRetries: 2,
  });

  // Strip wrapping quotes / backticks / smart quotes; trim leading
  // labels like "Caption:" some models prepend despite the rules.
  return text
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '')
    .replace(/^caption:\s*/i, '')
    .trim();
};

/**
 * Generate the stamp image via Gemini 2.5 Flash Image.
 *
 * Picks the first credentialed provider in priority order, matching
 * `packages/sendero-ocr/src/providers/gemini-multimodal.ts::pickProvider`:
 *
 *   1. **Vercel AI Gateway** — when `AI_GATEWAY_API_KEY` /
 *      `VERCEL_OIDC_TOKEN` is set. Consolidates billing, falls over
 *      across gateway-side providers.
 *   2. **Vertex AI direct** — when `GOOGLE_CLOUD_PROJECT` (+ ADC or
 *      `GOOGLE_APPLICATION_CREDENTIALS_JSON`). Bypasses the AI Studio
 *      free-tier ceiling, billed via the GCP project.
 *   3. **AI Studio direct** — when `GOOGLE_GENERATIVE_AI_API_KEY` /
 *      `GEMINI_API_KEY`. Free tier; works as long as the key has
 *      "Generative Language API" in its API restrictions.
 *
 * Returns a `data:image/png;base64,…` data URL so the next step
 * (`pin-to-ipfs`) can fetch the bytes without a second model call.
 *
 * WDK retries this step on transient failures (5xx, timeout) up to
 * the WDK default. A persistent failure surfaces as a workflow error
 * — the operator re-runs the workflow with the same primaryKey and
 * we short-circuit at `mint_stamp` if the row was already created.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { type LanguageModel, generateText } from 'ai';

const GATEWAY_MODEL = 'google/gemini-2.5-flash-image-preview' as const;
const DIRECT_MODEL = 'gemini-2.5-flash-image-preview' as const;

interface PickedProvider {
  provider: 'gateway' | 'vertex' | 'google';
  model: LanguageModel;
}

function pickImageProvider(): PickedProvider | null {
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    return { provider: 'gateway', model: GATEWAY_MODEL };
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
        // Fall through to AI Studio direct if the SA JSON is invalid.
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
      return { provider: 'vertex', model: vertex(DIRECT_MODEL) };
    }
  }
  const directKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (directKey) {
    const google = createGoogleGenerativeAI({ apiKey: directKey });
    return { provider: 'google', model: google(DIRECT_MODEL) };
  }
  return null;
}

export const generateStampImage = async (prompt: string): Promise<string> => {
  'use step';

  const picked = pickImageProvider();
  if (!picked) {
    throw new Error(
      'No Gemini credentials configured. Set AI_GATEWAY_API_KEY (preferred), GOOGLE_CLOUD_PROJECT (+ADC) for Vertex, or GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY for direct AI Studio.'
    );
  }

  const { files } = await generateText({
    model: picked.model,
    prompt,
    maxRetries: 2,
  });

  const file = files.at(0);
  if (!file?.base64) {
    throw new Error(`gemini_${picked.provider}_returned_no_image`);
  }

  const mediaType = file.mediaType || 'image/png';
  return `data:${mediaType};base64,${file.base64}`;
};

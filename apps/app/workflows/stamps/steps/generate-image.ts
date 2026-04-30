/**
 * Generate the stamp image via Gemini 2.5 Flash Image.
 *
 * Picks the first credentialed provider in priority order, matching
 * `packages/ocr/src/providers/gemini-multimodal.ts::pickProvider`:
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
import { aiTelemetryConfig } from '@sendero/langfuse';
import { type LanguageModel, generateText } from 'ai';

// As of Apr 2026: AI Studio renamed the public image model from
// `gemini-2.5-flash-image-preview` → `gemini-2.5-flash-image`. The
// gateway alias keeps working for back-compat, but direct AI Studio
// 404s on the old name. Use the un-suffixed canonical id everywhere.
const GATEWAY_MODEL = 'google/gemini-2.5-flash-image' as const;
const DIRECT_MODEL = 'gemini-2.5-flash-image' as const;

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

/**
 * Image reference attached to the multimodal request. URL is fetched
 * server-side by Vertex / Gemini — keeps the prompt token-cheap (no
 * base64 payload) and the moodboard files small enough to round-trip
 * without rate-limiting on the public app host.
 */
export interface StampImageReference {
  url: string;
  /** Inline guidance fed into the text portion so the model knows how to use this image. */
  guidance: string;
}

/**
 * Vertex AI fetches reference image URLs server-side. URLs hosted on
 * `localhost` (or any private DNS) won't resolve from Google's
 * network — drop the refs in dev so the text prompt still runs. The
 * brand vocabulary in the prompt body still steers the output; we
 * just lose the visual anchor until a public hostname is reachable.
 */
function refsAreReachable(refs: StampImageReference[]): boolean {
  if (refs.length === 0) return false;
  const first = refs[0]?.url ?? '';
  return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|::1|\[::1\])/i.test(first);
}

export const generateStampImage = async (
  prompt: string,
  references: StampImageReference[] = []
): Promise<string> => {
  'use step';

  const picked = pickImageProvider();
  if (!picked) {
    throw new Error(
      'No Gemini credentials configured. Set AI_GATEWAY_API_KEY (preferred), GOOGLE_CLOUD_PROJECT (+ADC) for Vertex, or GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY for direct AI Studio.'
    );
  }

  const usableRefs = refsAreReachable(references) ? references : [];
  if (references.length > 0 && usableRefs.length === 0) {
    console.warn(
      '[generate-image] dropping moodboard refs — NEXT_PUBLIC_APP_URL points at a host Vertex cannot fetch (localhost). Prompt text-only.'
    );
  }

  // Fold any reference-image guidance into the text portion so the
  // model knows what to copy + what to ignore (especially names/PII
  // baked into the brand assets).
  const guidanceLines = usableRefs
    .map((r, i) => `Reference image ${i + 1}: ${r.guidance}`)
    .join('\n');
  const fullText = guidanceLines ? `${prompt}\n\n${guidanceLines}` : prompt;

  // Multimodal when refs are reachable; text-only when they're not.
  // Vertex Gemini fetches URLs server-side — no base64 bloat in the
  // request envelope.
  const messages =
    usableRefs.length > 0
      ? [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: fullText },
              ...usableRefs.map(r => ({
                type: 'image' as const,
                image: r.url,
              })),
            ],
          },
        ]
      : [{ role: 'user' as const, content: fullText }];

  const { files } = await generateText({
    model: picked.model,
    messages,
    maxRetries: 2,
    experimental_telemetry: aiTelemetryConfig('sendero-stamp-gen', {
      surface: 'app-api',
      trigger: 'system',
      model: GATEWAY_MODEL,
      scope: 'stamp-image',
    }),
  });

  const file = files.at(0);
  if (!file?.base64) {
    throw new Error(`gemini_${picked.provider}_returned_no_image`);
  }

  const mediaType = file.mediaType || 'image/png';
  return `data:${mediaType};base64,${file.base64}`;
};

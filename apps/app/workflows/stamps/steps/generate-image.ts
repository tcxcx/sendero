/**
 * Generate the stamp image via the Vercel AI Gateway → Gemini 2.5
 * Flash Image model. Returns a `data:image/png;base64,…` data URL
 * so the next step can either pin it to IPFS as bytes or upload it
 * to Vercel Blob without re-fetching.
 *
 * WDK retries this step on transient failures (gateway 5xx, timeout)
 * up to the WDK default. A persistent failure surfaces as a workflow
 * error — the operator can re-run the whole workflow with the same
 * primaryKey and we short-circuit at `mint_stamp` if the row was
 * already created.
 */

import { generateText } from 'ai';

export const generateStampImage = async (prompt: string): Promise<string> => {
  'use step';

  const { files } = await generateText({
    model: 'google/gemini-2.5-flash-image-preview',
    prompt,
  });

  const file = files.at(0);
  if (!file?.base64) {
    throw new Error('gemini_returned_no_image');
  }

  const mediaType = file.mediaType || 'image/png';
  return `data:${mediaType};base64,${file.base64}`;
};

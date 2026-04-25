/**
 * Generate the OG description / collection-grid hover caption via
 * GPT-5-nano routed through the Vercel AI Gateway. We bias toward
 * one short line so the unfurl preview text fits neatly under the
 * art (Slack ~150 chars, WhatsApp ~160 chars before truncation).
 */

import { generateText } from 'ai';

export const generateStampCaption = async (prompt: string): Promise<string> => {
  'use step';

  const { text } = await generateText({
    model: 'openai/gpt-5-nano',
    prompt,
  });

  // GPT-5-nano sometimes wraps in quotes or adds a trailing period block;
  // strip both so the caption is OG-clean and unfurl-friendly.
  return text.replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '').trim();
};

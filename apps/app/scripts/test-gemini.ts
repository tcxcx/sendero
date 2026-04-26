import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { type LanguageModel, generateText } from 'ai';

const PROMPT =
  'A tiny pixel-art parchment stamp icon, 64x64, deep vermillion ink. Single PNG output.';

async function tryProvider(name: string, model: LanguageModel) {
  const t0 = Date.now();
  try {
    const { files } = await generateText({
      model,
      messages: [{ role: 'user' as const, content: PROMPT }],
      maxRetries: 0,
    });
    const file = files.at(0);
    const ms = Date.now() - t0;
    if (!file?.base64) return `${name}: NO_IMAGE (${ms}ms)`;
    return `${name}: OK ${file.mediaType ?? 'image/png'} ${Math.round((file.base64.length * 3) / 4)}B (${ms}ms)`;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    return `${name}: FAIL ${msg.slice(0, 240).replace(/\n/g, ' ')} (${ms}ms)`;
  }
}

const results: string[] = [];

if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
  results.push(
    await tryProvider('GATEWAY', 'google/gemini-2.5-flash-image' as unknown as LanguageModel)
  );
}
if (process.env.GOOGLE_CLOUD_PROJECT) {
  const vertex = createVertex({
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  });
  results.push(await tryProvider('VERTEX', vertex('gemini-2.5-flash-image')));
}
const directKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
if (directKey) {
  const google = createGoogleGenerativeAI({ apiKey: directKey });
  results.push(await tryProvider('AISTUDIO', google('gemini-2.5-flash-image')));
}

for (const r of results) console.log(r);

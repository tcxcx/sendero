/**
 * GET /docs/<slug>.md
 *
 * LLM-friendly plaintext-markdown export of any docs page.  Agents
 * and scrapers append `.md` to any doc URL and get the raw source
 * without the docs-shell chrome — exactly the pattern Sherpa uses
 * for their "Trips LLM Friendly" endpoint, except we automate it for
 * every page in the tree.
 *
 * Example:
 *   Browser:   https://docs.sendero.travel/docs/tools/search_flights
 *   LLM:       https://docs.sendero.travel/docs/tools/search_flights.md
 *
 * We read the MDX file off disk and serve it as-is (frontmatter
 * stripped).  No conversion to HTML, no JSX component resolution —
 * the markdown source is the canonical LLM surface.
 *
 * Route works for both the catch-all `docs/[[...slug]].md` and the
 * root `docs.md` (index page).
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DOCS_ROOT = resolve(process.cwd(), 'content/docs');

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const segments = (slug ?? []).filter(s => s !== '');

  // Try `<slug>.mdx` first, then `<slug>/index.mdx`, then the root `index.mdx`.
  const candidates = segments.length
    ? [
        resolve(DOCS_ROOT, `${segments.join('/')}.mdx`),
        resolve(DOCS_ROOT, segments.join('/'), 'index.mdx'),
      ]
    : [resolve(DOCS_ROOT, 'index.mdx')];

  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf8');
      return new Response(stripFrontmatter(raw), {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'public, max-age=3600, s-maxage=3600',
          'access-control-allow-origin': '*',
        },
      });
    } catch {
      // try next candidate
    }
  }

  return new Response(`# Not found\n\n\`${segments.join('/')}\` has no markdown source.\n`, {
    status: 404,
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}

/** Strip YAML/TOML frontmatter so LLMs don't confuse it with body copy. */
function stripFrontmatter(src: string): string {
  const match = src.match(/^---\n[\s\S]*?\n---\n/);
  return match ? src.slice(match[0].length).trimStart() : src;
}

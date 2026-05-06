/**
 * @sendero/web-search/cse — Google Custom Search wrapper.
 *
 * Calls the Custom Search JSON API
 * (`https://www.googleapis.com/customsearch/v1`) with the
 * project's pre-configured search engine (CSE / Programmable Search
 * Engine). The CSE is curated with 50 high-signal taste/event sources
 * (Michelin, 50 Best, Sprudge, lu.ma, *.meetup.com, *.eventbrite.com,
 * Songkick, Eater, Monocle, Tabelog, Time Out, Atlas Obscura, Dezeen,
 * Wallpaper, Yelp, Foursquare, Substack, Medium, etc.) AND has
 * "Search the entire web" enabled, so these 50 are *boosted* sources
 * but the engine still searches all of the web.
 *
 * Used by HP1/HP2 anticipation tools as the search-fallback primitive
 * when Google Places doesn't have the place / when the agent wants
 * editorial / when the LLM-as-judge needs source URLs.
 *
 * **Quotas.** Custom Search JSON API: 100 free queries/day; $5/1k
 * after, hard-capped at 10k/day per project. HP1/HP2 tools should
 * cache aggressively (`source_cache_manager` per Appendix A.7 #43).
 *
 * **Returns `{ available: false, reason }` on every error path.**
 * Never throws. Caller treats `available === false` as cold-path.
 */

import { senderoFetch } from './_fetch';
import { getCseApiKey, getCseEngineId, isCseEnabled } from './client';
import type { CseSearchArgs, CseSearchHit, CseSearchResult } from './types';

const ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

export async function cseSearch(args: CseSearchArgs): Promise<CseSearchResult> {
  if (!isCseEnabled()) {
    return { available: false, reason: 'cse-not-configured', results: [] };
  }

  const apiKey = getCseApiKey()!;
  const cx = getCseEngineId()!;
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

  // Site-scoped queries get a `site:<host>` prefix. CSE supports this
  // even when "Search the entire web" is on — the prefix simply
  // narrows the result set to the named host.
  const q = args.site ? `site:${args.site} ${args.query}` : args.query;

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('num', String(limit));
  if (args.start) url.searchParams.set('start', String(args.start));
  if (args.country) url.searchParams.set('gl', args.country);
  if (args.lang) url.searchParams.set('hl', args.lang);
  if (args.freshness) url.searchParams.set('dateRestrict', args.freshness);

  try {
    const res = await senderoFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs: args.timeoutMs ?? 5000,
    });

    if (!res.ok) {
      return { available: false, reason: `cse-http-${res.status}`, results: [] };
    }

    const data = (await res.json()) as
      | {
          items?: Array<{
            title?: string;
            snippet?: string;
            link?: string;
            displayLink?: string;
            formattedUrl?: string;
            htmlSnippet?: string;
            cacheId?: string;
            pagemap?: Record<string, unknown>;
          }>;
          searchInformation?: { totalResults?: string; searchTime?: number };
          error?: { code?: number; message?: string };
        }
      | null;

    if (data?.error) {
      return {
        available: false,
        reason: `cse-api-error-${data.error.code ?? 'unknown'}`,
        results: [],
      };
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const hits: CseSearchHit[] = items
      .map(i => mapHit(i))
      .filter((h): h is CseSearchHit => h !== null);

    return {
      available: true,
      results: hits,
      ...(data?.searchInformation?.totalResults
        ? { totalResults: data.searchInformation.totalResults }
        : {}),
      ...(typeof data?.searchInformation?.searchTime === 'number'
        ? { searchTime: data.searchInformation.searchTime }
        : {}),
    };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? `cse-process-${err.name}` : 'cse-process-error',
      results: [],
    };
  }
}

function mapHit(raw: {
  title?: string;
  snippet?: string;
  link?: string;
  displayLink?: string;
  formattedUrl?: string;
  htmlSnippet?: string;
  cacheId?: string;
  pagemap?: Record<string, unknown>;
}): CseSearchHit | null {
  if (typeof raw.title !== 'string' || typeof raw.link !== 'string') return null;
  return {
    title: raw.title,
    snippet: raw.snippet ?? '',
    link: raw.link,
    displayLink: raw.displayLink ?? '',
    formattedUrl: raw.formattedUrl ?? raw.link,
    ...(raw.htmlSnippet ? { htmlSnippet: raw.htmlSnippet } : {}),
    ...(raw.cacheId ? { cacheId: raw.cacheId } : {}),
    ...(raw.pagemap ? { pagemap: raw.pagemap } : {}),
  };
}

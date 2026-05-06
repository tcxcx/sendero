# @sendero/web-search

Google Custom Search Engine wrapper for HP1/HP2 anticipation tools.

Spec: [`docs/specs/anticipatory-concierge.md`](../../docs/specs/anticipatory-concierge.md) Appendix A (HP1 + HP2 tool catalog).

## Quick start

```ts
import { cseSearch } from '@sendero/web-search';

const result = await cseSearch({
  query: 'best specialty coffee to work from',
  site: 'sprudge.com',
  country: 'jp',
  freshness: 'y1',
  limit: 5,
});

if (!result.available) {
  // fall through — caller plans cold; reason in result.reason
  return;
}

for (const hit of result.results) {
  console.log(hit.title, hit.link, hit.snippet);
}
```

## Env

```
GOOGLE_API_KEY="…"                              # the GCP key with Custom Search API enabled
GOOGLE_CUSTOM_SEARCH_API_KEY="…"                # optional — overrides GOOGLE_API_KEY for CSE-specific quota isolation
GOOGLE_CUSTOM_SEARCH_ENGINE_ID="b230136b…"      # the cx ID from programmablesearchengine.google.com
WEB_SEARCH_ENABLED="false"                      # optional kill-switch
```

The CSE itself (Programmable Search Engine) is curated with 50 high-signal taste/event sources (Michelin, 50 Best, Sprudge, lu.ma, *.meetup.com, *.eventbrite.com, Songkick, Eater, Monocle, Tabelog, Time Out, Atlas Obscura, Dezeen, Wallpaper, Yelp, Foursquare, Substack, Medium, plus more) AND has **"Search the entire web"** enabled — these 50 are boosted; queries still cover the open web.

## Quotas

Custom Search JSON API:
- **Free tier:** 100 queries/day per GCP project
- **Paid:** $5 / 1,000 queries, hard-capped at 10,000/day

HP1/HP2 tools must cache aggressively. Reference: Appendix A.7 #43 `source_cache_manager` (per-bucket × per-city × per-day).

## Resilience

Mirrors `@sendero/arize-phoenix/_fetch` shape: native fetch first, `curl --http1.1` fallback on bot-challenge detection (`200 + text/html` when JSON was requested). Google's CSE endpoint typically responds cleanly to native fetch; the fallback is defense + parity. Telemetry exposes `via: 'native' | 'curl' | 'error'` on every response.

## Always fail-soft

Every error path returns `{ available: false, reason }` instead of throwing. Callers treat `available === false` as cold-path (plan from scratch, fall through to traveler ask, etc.). Never crashes the parent agent turn.

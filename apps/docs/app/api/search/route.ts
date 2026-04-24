import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

/** Orama index is built per request; avoid CDN caching empty or stale JSON. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const search = createFromSource(source);

export const GET = search.GET;

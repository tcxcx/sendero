/**
 * Local dev server — Bun-native. Serves the Hono app from `./index`
 * on $PORT. Vercel deploys via `api/[[...route]].ts` instead of this
 * file.
 */

import app from './index';

const port = Number(process.env.PORT ?? 3021);

if (typeof (globalThis as any).Bun !== 'undefined') {
  (globalThis as any).Bun.serve({ port, fetch: app.fetch });
  // eslint-disable-next-line no-console
  console.log(`[sendero/edge] dev on :${port}`);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[sendero/edge] server.ts requires Bun. Use apps/edge/api/[[...route]].ts on Vercel.'
  );
}

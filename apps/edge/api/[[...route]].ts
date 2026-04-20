/**
 * Vercel entrypoint — serverless Node function wrapping the Hono app.
 * Deployed as `sendero-arc-edge` with Root Directory = apps/edge/.
 * Works on Vercel's Node runtime (not Edge — we need Circle SDKs which
 * depend on viem/crypto polyfills outside the Edge runtime).
 */

import { handle } from 'hono/vercel';
import app from '../src/index.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);

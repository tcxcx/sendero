/**
 * @sendero/database — Prisma client singleton.
 *
 * Two runtimes:
 *   - Edge / Vercel Edge / Hono on Cloudflare: use the Neon serverless driver
 *     via @prisma/adapter-neon.
 *   - Node (dev, scripts, seed): default Prisma connection pool.
 *
 * The flag that picks between them is `SENDERO_DB_DRIVER`:
 *   - "neon"  → serverless WebSocket driver (edge-compatible).
 *   - "node"  → default pg driver (fastest in dev / CLI).
 *
 * Defaults to "neon" in production, "node" locally.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';

// Required for Node runtimes where global WebSocket isn't available.
if (typeof globalThis.WebSocket === 'undefined') {
  // @ts-expect-error — runtime polyfill
  neonConfig.webSocketConstructor = ws;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // Don't throw at import time — allow `prisma generate` without env.
  // Consumers will get a clear error on first query if truly missing.
  console.warn('[@sendero/database] DATABASE_URL is not set');
}

type GlobalWithPrisma = typeof globalThis & {
  __senderoPrisma?: PrismaClient;
};

const g = globalThis as GlobalWithPrisma;

function makeClient(): PrismaClient {
  const driver = process.env.SENDERO_DB_DRIVER
    ?? (process.env.VERCEL_ENV === 'production' ? 'neon' : 'node');

  if (driver === 'neon' && DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma: PrismaClient = g.__senderoPrisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  g.__senderoPrisma = prisma;
}

export * from '@prisma/client';
export * as Types from './types';
export { PrismaClient } from '@prisma/client';

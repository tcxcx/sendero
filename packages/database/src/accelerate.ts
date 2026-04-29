/**
 * @sendero/database/accelerate — Accelerate-extended Prisma client.
 *
 * Sibling to the default `prisma` export. Use this client for read paths
 * that benefit from Prisma Accelerate's connection pooling + query
 * result cache:
 *
 *   - High-fanout reads on hot tables (Tenant, User, CircleWallet)
 *   - Anything called from edge / Vercel functions where serverless
 *     cold starts pay the connection-establishment cost
 *   - Read paths where ~minute-scale staleness is acceptable
 *
 * DO NOT use for:
 *   - Writes (Accelerate adds latency on the write path; use the
 *     default `prisma` singleton instead)
 *   - Reads inside transactions that mutate (consistency boundary)
 *   - Reads that need real-time freshness (use `prisma` or Pulse
 *     subscriptions)
 *
 * Configuration:
 *   - `PRISMA_ACCELERATE_URL` env var with `prisma://` or
 *     `prisma+postgres://` connection string from console.prisma.io.
 *   - Falls back to `DATABASE_URL` if the Accelerate URL isn't set
 *     (Accelerate becomes a no-op pass-through). This means import
 *     sites work in local dev without the Prisma Data Platform set up.
 *
 * Usage:
 *   import { prismaAccelerated } from '@sendero/database/accelerate';
 *
 *   // Cached for 60s; subsequent calls within window skip Postgres.
 *   const tenant = await prismaAccelerated.tenant.findUnique({
 *     where: { id: tenantId },
 *     cacheStrategy: { ttl: 60 },
 *   });
 *
 * Cache invalidation: writes through the default `prisma` singleton
 * automatically invalidate Accelerate's cache for the affected rows
 * (Prisma Data Platform handles this server-side via the same
 * connection layer).
 */

import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

const ACCELERATE_URL = process.env.PRISMA_ACCELERATE_URL ?? process.env.DATABASE_URL;

type GlobalWithAccelerate = typeof globalThis & {
  __senderoPrismaAccelerated?: ReturnType<typeof makeAcceleratedClient>;
};

const g = globalThis as GlobalWithAccelerate;

function makeAcceleratedClient() {
  const base = ACCELERATE_URL
    ? new PrismaClient({
        datasourceUrl: ACCELERATE_URL,
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      })
    : new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      });
  return base.$extends(withAccelerate());
}

export const prismaAccelerated = g.__senderoPrismaAccelerated ?? makeAcceleratedClient();

if (process.env.NODE_ENV !== 'production') {
  g.__senderoPrismaAccelerated = prismaAccelerated;
}

import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // No auth — returns booleans + lengths only, no values. Temporary probe.
  void req;
  const kek = process.env.PASSPORT_VAULT_KEK;
  return NextResponse.json({
    PASSPORT_VAULT_KEK_set: Boolean(kek),
    PASSPORT_VAULT_KEK_len: kek?.length ?? 0,
    PASSPORT_VAULT_KEK_endsEqual: kek?.endsWith('=') ?? false,
    KAPSO_GLOBAL_WEBHOOK_SECRET_set: Boolean(process.env.KAPSO_GLOBAL_WEBHOOK_SECRET),
    DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
  });
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');
const repoEnvPath = resolve(workspaceRoot, '.env.local');

function readDotenvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadLocalRootEnv() {
  if (!existsSync(repoEnvPath)) return;

  // Marketing reads NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL to build links
  // into the app + canonical metadata. Without these the dev site falls back
  // to the production origin and CTAs leave localhost. Clerk keys are loaded
  // here too so dev sign-in works without an apps/marketing/.env.local.
  const ROOT_KEYS =
    /^\s*(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_SITE_URL)\s*=\s*(.*)\s*$/;

  for (const line of readFileSync(repoEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(ROOT_KEYS);
    if (!match) continue;

    const [, key, rawValue] = match;
    process.env[key] ||= readDotenvValue(rawValue);
  }
}

loadLocalRootEnv();

const publicClerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Marketing has no auth surface — sign-in/sign-up live on the app
// (Clerk-hosted there). Redirect /sign-in and /sign-up (with any
// subpath / query string) to the app origin so deep-links from press,
// docs, or stale bookmarks land on the real auth screen instead of a
// marketing 404.
const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.sendero.travel').replace(
  /\/$/,
  ''
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/sign-in', destination: `${appOrigin}/sign-in`, permanent: false },
      { source: '/sign-in/:path*', destination: `${appOrigin}/sign-in/:path*`, permanent: false },
      { source: '/sign-up', destination: `${appOrigin}/sign-up`, permanent: false },
      { source: '/sign-up/:path*', destination: `${appOrigin}/sign-up/:path*`, permanent: false },
    ];
  },
  ...(publicClerkPublishableKey
    ? { env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicClerkPublishableKey } }
    : {}),
};

export default nextConfig;

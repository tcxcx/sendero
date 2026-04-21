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

function loadLocalClerkEnv() {
  if (!existsSync(repoEnvPath)) return;

  for (const line of readFileSync(repoEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    process.env[key] ||= readDotenvValue(rawValue);
  }
}

loadLocalClerkEnv();

const publicClerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  ...(publicClerkPublishableKey
    ? { env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicClerkPublishableKey } }
    : {}),
};

export default nextConfig;

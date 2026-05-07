import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  // Provision-multisig flows depend on Circle + Squads SDKs which run
  // server-only. Mirror apps/app's externalization pattern.
  serverExternalPackages: [
    '@circle-fin/developer-controlled-wallets',
    '@circle-fin/modular-wallets-core',
  ],
};

export default nextConfig;

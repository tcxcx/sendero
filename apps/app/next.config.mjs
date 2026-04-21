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
  serverExternalPackages: [
    '@circle-fin/developer-controlled-wallets',
    '@circle-fin/modular-wallets-core',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.duffel.com' },
      { protocol: 'https', hostname: 'images.duffel.com' },
      { protocol: 'https', hostname: 'duffel-assets.duffel.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

export default nextConfig;

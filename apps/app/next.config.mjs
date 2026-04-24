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
  // Legacy /app/* routes were renamed to /dashboard/* (see app/(app)/dashboard).
  // Redirect old bookmarks, email links, and third-party callbacks so nothing
  // that pre-dated the rename 404s.
  async redirects() {
    return [
      { source: '/app', destination: '/dashboard', permanent: true },
      { source: '/app/:path*', destination: '/dashboard/:path*', permanent: true },
    ];
  },
};

export default nextConfig;

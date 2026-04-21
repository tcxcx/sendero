import { createMDX } from 'fumadocs-mdx/next';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();
const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  // We pull the shared globals.css out of the root Next app so the
  // docs site speaks the exact same vermilion token vocabulary.
  transpilePackages: ['@sendero/tools', '@sendero/llms'],
  // MDX is heavy; let Next inline server components where possible.
  serverExternalPackages: ['shiki'],
};

export default withMDX(config);

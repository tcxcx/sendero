import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // We pull the shared globals.css out of the root Next app so the
  // docs site speaks the exact same vermilion token vocabulary.
  transpilePackages: ['@sendero/tools'],
  experimental: {
    // MDX is heavy; let Next inline server components where possible.
    serverComponentsExternalPackages: ['shiki'],
  },
};

export default withMDX(config);

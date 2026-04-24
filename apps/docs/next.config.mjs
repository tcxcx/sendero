import { createMDX } from 'fumadocs-mdx/next';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();
const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');

const zodMiniStubPath = resolve(__dirname, 'lib/zod-mini-stub.ts');

/** @type {import('next').NextConfig} */
const config = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: {
    root: workspaceRoot,
    // `@scalar/agent-chat` (transitive of `@scalar/api-reference-react`)
    // imports `zod/mini` (zod v4 only). The workspace pins
    // `zod: ^3.25.76` because the rest of our code targets v3. The
    // chat code path is dead in our docs, but Turbopack still has to
    // resolve every import — alias to a v3 re-export.
    resolveAlias: {
      'zod/mini': zodMiniStubPath,
    },
  },
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  // We pull the shared globals.css out of the root Next app so the
  // docs site speaks the exact same vermilion token vocabulary.
  transpilePackages: [
    '@sendero/tools',
    '@sendero/llms',
    '@sendero/seo',
    '@sendero/locale',
    '@sendero/ui',
  ],
  // MDX is heavy; let Next inline server components where possible.
  serverExternalPackages: ['shiki'],
  webpack(webpackConfig) {
    // Mirror the Turbopack alias for the webpack build path that some
    // Next CI runs still fall back to.
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.alias = {
      ...(webpackConfig.resolve.alias ?? {}),
      'zod/mini': zodMiniStubPath,
    };
    return webpackConfig;
  },
};

export default withMDX(config);

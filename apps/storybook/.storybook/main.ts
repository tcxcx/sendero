import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const storybookDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Storybook 8 on the Vite builder — faster HMR than webpack and
 * avoids doubling bundler config with the main Next app.
 */
const config: StorybookConfig = {
  stories: [
    '../stories/**/*.stories.@(ts|tsx|mdx)',
    '../../../packages/ui/src/stories/**/*.stories.@(ts|tsx|mdx)',
  ],
  staticDirs: ['../public'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-interactions',
    '@storybook/addon-themes',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  viteFinal: async cfg =>
    mergeConfig(cfg, {
      define: {
        'process.env': {},
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
        'process.env.__NEXT_ROUTER_BASEPATH': JSON.stringify(''),
        'process.env.__NEXT_TRAILING_SLASH': JSON.stringify(''),
        'process.env.NEXT_PUBLIC_SENDERO_EDGE_URL': JSON.stringify(
          process.env.NEXT_PUBLIC_SENDERO_EDGE_URL ?? 'http://localhost:3021'
        ),
      },
      optimizeDeps: {
        esbuildOptions: {
          define: {
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
            'process.env.__NEXT_ROUTER_BASEPATH': JSON.stringify(''),
            'process.env.__NEXT_TRAILING_SLASH': JSON.stringify(''),
            'process.env.NEXT_PUBLIC_SENDERO_EDGE_URL': JSON.stringify(
              process.env.NEXT_PUBLIC_SENDERO_EDGE_URL ?? 'http://localhost:3021'
            ),
          },
        },
      },
      resolve: {
        alias: {
          // Let stories import production components from the monorepo
          // root without rewriting them.
          '@app': path.resolve(storybookDir, '../../app/app'),
          '@components': path.resolve(storybookDir, '../../app/components'),
          'next/image': path.resolve(storybookDir, './mocks/next-image.tsx'),
          'next/link': path.resolve(storybookDir, './mocks/next-link.tsx'),
          'next/navigation': path.resolve(storybookDir, './mocks/next-navigation.ts'),
        },
      },
    }),
};

export default config;

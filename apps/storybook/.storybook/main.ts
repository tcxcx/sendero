import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import path from 'node:path';

/**
 * Storybook 8 on the Vite builder — faster HMR than webpack and
 * avoids doubling bundler config with the main Next app.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx|mdx)'],
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
      resolve: {
        alias: {
          // Let stories import production components from the monorepo
          // root without rewriting them.
          '@app': path.resolve(__dirname, '../../../app'),
          '@components': path.resolve(__dirname, '../../../components'),
        },
      },
    }),
};

export default config;

import type { Config } from 'tailwindcss';
import uiConfig from '@sendero/ui/tailwind.config';

export default {
  presets: [uiConfig],
  content: [
    './stories/**/*.{ts,tsx,mdx}',
    '../app/app/**/*.{ts,tsx,mdx}',
    '../app/components/**/*.{ts,tsx,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;

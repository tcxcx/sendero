import type { MetadataRoute } from 'next';

const DESCRIPTION =
  'Agent-native travel booking for travelers, agencies, corporate teams, and AI agents.';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sendero',
    short_name: 'Sendero',
    description: DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4efe7',
    theme_color: '#cc4b37',
    categories: ['travel', 'business'],
    icons: [
      { src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/brand/seo/app-icon-store-ready-1024.png',
        sizes: '1024x1024',
        type: 'image/png',
      },
    ],
  };
}

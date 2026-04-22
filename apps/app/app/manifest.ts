import type { MetadataRoute } from 'next';

const DESCRIPTION =
  'Tenant console for Sendero trips, invoices, MCP tools, billing, policy caps, and Arc USDC settlement.';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sendero App',
    short_name: 'Sendero',
    description: DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4efe7',
    theme_color: '#cc4b37',
    categories: ['travel', 'productivity', 'business'],
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

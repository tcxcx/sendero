/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
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

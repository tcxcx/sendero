import { buildRobots, resolvePublicOrigin } from '@sendero/seo';

const SITE_URL = resolvePublicOrigin(process.env.NEXT_PUBLIC_APP_URL, 'https://app.sendero.travel');

export default function robots() {
  return buildRobots({
    siteUrl: SITE_URL,
    allow: [
      '/',
      '/llms.txt',
      '/.well-known/llms.txt',
      '/api/mcp',
      '/api/health',
      '/waitlist',
      '/onboarding',
    ],
    disallow: [
      '/dashboard/',
      '/admin/',
      '/settings/',
      '/billing/',
      '/api/webhooks/',
      '/api/agent/dispatch',
      '/api/liveblocks-auth',
    ],
    agentAllow: ['/', '/llms.txt', '/.well-known/llms.txt', '/api/mcp', '/api/health'],
    agentDisallow: [
      '/dashboard/',
      '/admin/',
      '/settings/',
      '/billing/',
      '/api/webhooks/',
      '/api/agent/dispatch',
      '/api/liveblocks-auth',
    ],
  });
}

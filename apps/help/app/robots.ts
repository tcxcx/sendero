import { buildRobots, resolvePublicOrigin } from '@sendero/seo';

const SITE_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_HELP_URL,
  'https://help.sendero.travel'
);

export default function robots() {
  return buildRobots({
    siteUrl: SITE_URL,
    allow: ['/', '/article/', '/llms.txt', '/.well-known/llms.txt'],
    disallow: ['/api/webhooks/', '/admin/'],
    agentAllow: ['/', '/article/', '/llms.txt', '/.well-known/llms.txt'],
    agentDisallow: ['/api/webhooks/', '/admin/'],
  });
}

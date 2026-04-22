import { buildRobots, resolvePublicOrigin } from '@sendero/seo';

const SITE_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_DOCS_URL,
  'https://docs.sendero.travel'
);

export default function robots() {
  return buildRobots({
    siteUrl: SITE_URL,
    allow: ['/', '/docs/', '/llms.txt', '/.well-known/llms.txt'],
    disallow: ['/api/webhooks/', '/admin/'],
    agentAllow: ['/', '/docs/', '/llms.txt', '/.well-known/llms.txt'],
    agentDisallow: ['/api/webhooks/', '/admin/'],
  });
}

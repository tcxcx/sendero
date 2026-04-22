import { buildRobots } from '@sendero/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sendero.travel';

export default function robots() {
  return buildRobots({
    siteUrl: SITE_URL,
  });
}

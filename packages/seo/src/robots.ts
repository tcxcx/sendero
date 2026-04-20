/**
 * robots.txt builder for Next.js `app/robots.ts`.
 *
 * Sendero exposes two public agent surfaces (/.well-known/llms.txt +
 * /api/mcp) that LLM crawlers should be allowed to index, while the
 * product console (/app, /admin) + the webhook routes must stay out
 * of SERPs.
 */

export interface RobotsConfig {
  siteUrl: string;
  disallow?: string[];
  allow?: string[];
  /** Include `Host:` + `Sitemap:` lines. Defaults to true. */
  includeSitemap?: boolean;
  /** Optional extra agent-specific blocks. */
  userAgentRules?: Array<{ userAgent: string; allow?: string[]; disallow?: string[] }>;
}

export interface RobotsOutput {
  rules: Array<{
    userAgent: string | string[];
    allow?: string[];
    disallow?: string[];
  }>;
  sitemap?: string;
  host?: string;
}

export function buildRobots(config: RobotsConfig): RobotsOutput {
  const rules: RobotsOutput['rules'] = [
    {
      userAgent: '*',
      allow: config.allow ?? ['/'],
      disallow: config.disallow ?? [
        '/api/webhooks/',
        '/api/agent/dispatch',
        '/api/liveblocks-auth',
        '/admin/',
      ],
    },
    ...(config.userAgentRules ?? []).map(r => ({
      userAgent: r.userAgent,
      allow: r.allow,
      disallow: r.disallow,
    })),
  ];

  return {
    rules,
    sitemap:
      config.includeSitemap === false
        ? undefined
        : `${trimTrailingSlash(config.siteUrl)}/sitemap.xml`,
    host: trimTrailingSlash(config.siteUrl),
  };
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

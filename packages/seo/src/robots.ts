/**
 * robots.txt builder for Next.js `app/robots.ts`.
 *
 * Sendero exposes two public agent surfaces (/.well-known/llms.txt +
 * /api/mcp) that LLM crawlers should be allowed to index, while the
 * product console (/dashboard, /admin) + the webhook routes must stay out
 * of SERPs.
 */

export interface RobotsConfig {
  siteUrl: string;
  disallow?: string[];
  allow?: string[];
  /** Include `Host:` + `Sitemap:` lines. Defaults to true. */
  includeSitemap?: boolean;
  /** Defaults to true. Set false when a non-webhook surface should only emit custom rules. */
  includeAgentUserAgents?: boolean;
  /** Agent crawler allow paths. Defaults to Sendero's public marketing/docs/help paths. */
  agentAllow?: string[];
  /** Agent crawler disallow paths. Defaults to protected app, webhook, and billing paths. */
  agentDisallow?: string[];
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

export const SENDERO_AGENT_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'OAI-SearchBot',
  'Applebot-Extended',
] as const;

export const SENDERO_AGENT_ALLOW_PATHS = ['/', '/llms.txt', '/.well-known/llms.txt'] as const;

export function buildRobots(config: RobotsConfig): RobotsOutput {
  const rules: RobotsOutput['rules'] = [
    {
      userAgent: '*',
      allow: config.allow ?? ['/', '/llms.txt', '/.well-known/llms.txt'],
      disallow: config.disallow ?? [
        '/api/webhooks/',
        '/api/agent/dispatch',
        '/api/liveblocks-auth',
        '/admin/',
      ],
    },
    ...(config.includeAgentUserAgents === false
      ? []
      : SENDERO_AGENT_USER_AGENTS.map(userAgent => ({
          userAgent,
          allow: config.agentAllow ?? [...SENDERO_AGENT_ALLOW_PATHS],
          disallow: config.agentDisallow ?? [
            '/api/webhooks/',
            '/api/liveblocks-auth',
            '/admin/',
            '/dashboard/',
            '/settings/',
            '/billing/',
          ],
        }))),
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

export function serializeRobots(output: RobotsOutput): string {
  const lines: string[] = [];

  for (const rule of output.rules) {
    const userAgents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent];

    for (const userAgent of userAgents) {
      lines.push(`User-agent: ${userAgent}`);
    }

    for (const path of rule.allow ?? []) {
      lines.push(`Allow: ${path}`);
    }

    for (const path of rule.disallow ?? []) {
      lines.push(`Disallow: ${path}`);
    }

    lines.push('');
  }

  if (output.sitemap) {
    lines.push(`Sitemap: ${output.sitemap}`);
  }

  if (output.host) {
    lines.push(`Host: ${output.host}`);
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

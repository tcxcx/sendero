export interface LlmsItem {
  label: string;
  href?: string;
  description?: string;
  /**
   * Tool-surface metadata. Structured fields the renderer surfaces as a
   * trailing parenthetical so an LLM agent reading llms.txt can find
   * scope + pricing without parsing the description prose.
   *
   * Convention introduced 2026-04-25 alongside the markup feature so
   * agents can answer "what does this tool need" without a docs hop.
   * Optional + back-compat: existing items without these fields render
   * unchanged.
   */
  requiredScopes?: readonly string[];
  optionalScopes?: readonly string[];
  /**
   * Per-call price in micro-USDC (1 USDC = 1_000_000). Renders as
   * `$<dollars>` rounded to four decimals in the rendered llms.txt.
   * For per-segment-priced tools, pass the highest segment's price
   * (ai_agent) so the agent gets the worst-case sticker.
   */
  pricingMicroUsdc?: number;
}

export interface LlmsSection {
  heading: string;
  body?: string;
  items?: LlmsItem[];
  code?: string;
}

export interface LlmsTxtConfig {
  title: string;
  summary: string;
  canonicalUrl: string;
  sections: LlmsSection[];
  notes?: string[];
}

const DEFAULT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=3600',
};

export function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

export function joinUrl(origin: string, path = '/'): string {
  const cleanOrigin = normalizeOrigin(origin);
  if (/^https?:\/\//.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanOrigin}${cleanPath}`;
}

export function absoluteUrl(origin: string, href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return joinUrl(origin, href);
}

function compactLines(lines: string[]): string {
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function renderItem(item: LlmsItem): string {
  const label = item.href ? `[${item.label}](${item.href})` : item.label;
  const meta = formatItemMeta(item);
  const head = item.description ? `${label} - ${item.description}` : label;
  return meta ? `- ${head} ${meta}` : `- ${head}`;
}

/**
 * Format the structured surface metadata as a trailing parenthetical.
 * Returns an empty string when no metadata fields are set so existing
 * catalog entries render unchanged.
 *
 * Shape: `(scopes: A; +optional: B, C; $0.0030)`. Parts are emitted
 * only when present so a tool with no scopes but a price renders as
 * `($0.0030)`.
 */
function formatItemMeta(item: LlmsItem): string {
  const parts: string[] = [];
  if (item.requiredScopes && item.requiredScopes.length > 0) {
    parts.push(`scopes: ${item.requiredScopes.join(', ')}`);
  }
  if (item.optionalScopes && item.optionalScopes.length > 0) {
    parts.push(`+optional: ${item.optionalScopes.join(', ')}`);
  }
  if (typeof item.pricingMicroUsdc === 'number' && item.pricingMicroUsdc >= 0) {
    parts.push(`$${(item.pricingMicroUsdc / 1_000_000).toFixed(4)}`);
  }
  return parts.length === 0 ? '' : `(${parts.join('; ')})`;
}

export function buildLlmsTxt(config: LlmsTxtConfig): string {
  const lines: string[] = [
    `# ${config.title}`,
    '',
    `> ${config.summary}`,
    '',
    `Canonical: ${config.canonicalUrl}`,
  ];

  for (const section of config.sections) {
    lines.push('', `## ${section.heading}`);
    if (section.body) lines.push('', section.body);
    if (section.items?.length) {
      lines.push('', ...section.items.map(renderItem));
    }
    if (section.code) {
      lines.push('', '```', section.code.trim(), '```');
    }
  }

  if (config.notes?.length) {
    lines.push('', '## Notes', '', ...config.notes.map(note => `- ${note}`));
  }

  return compactLines(lines);
}

export function buildLlmsResponse(config: LlmsTxtConfig): Response {
  return new Response(buildLlmsTxt(config), {
    headers: DEFAULT_HEADERS,
  });
}

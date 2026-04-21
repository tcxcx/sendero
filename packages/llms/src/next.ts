export interface LlmsItem {
  label: string;
  href?: string;
  description?: string;
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
  return item.description ? `- ${label} - ${item.description}` : `- ${label}`;
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

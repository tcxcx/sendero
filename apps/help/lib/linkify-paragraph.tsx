import type { ReactNode } from 'react';

const URL_RE = /https?:\/\/[^\s]+/g;
const TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/;

function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  const trailing = raw.match(TRAILING_PUNCTUATION_RE)?.[0] ?? '';
  const url = trailing ? raw.slice(0, -trailing.length) : raw;
  return { url, trailing };
}

export function linkifyParagraph(text: string): ReactNode {
  const matches = Array.from(text.matchAll(URL_RE));
  if (matches.length === 0) return text;

  const out: ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (start > cursor) out.push(text.slice(cursor, start));

    const { url, trailing } = splitTrailingPunctuation(raw);
    out.push(
      <a
        key={`${start}-${url}`}
        className="hp-article-link"
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {url}
      </a>
    );
    if (trailing) out.push(trailing);

    cursor = start + raw.length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));

  return out;
}

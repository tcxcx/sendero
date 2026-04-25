import { Fragment, type ReactNode } from 'react';

import { normalizeLocale, type SupportedLocale } from '@sendero/locale';

/** [travel-word, AI-word] substrings to highlight in hero title — must match `content.hero.title` per locale. */
const HERO_TITLE_HIGHLIGHTS: Record<
  SupportedLocale,
  readonly [travelToken: string, aiToken: string]
> = {
  'en-US': ['Travel', 'agent'],
  'es-MX': ['viajes', 'agentes'],
  'es-AR': ['viajes', 'agentes'],
  'pt-BR': ['viagens', 'agentes'],
};

function rangesForTitle(title: string, locale: SupportedLocale): { start: number; end: number }[] {
  const [travelWord, aiWord] = HERO_TITLE_HIGHLIGHTS[locale];
  const ranges: { start: number; end: number }[] = [];
  const t = title.indexOf(travelWord);
  if (t !== -1) ranges.push({ start: t, end: t + travelWord.length });
  const a = title.indexOf(aiWord);
  if (a !== -1) ranges.push({ start: a, end: a + aiWord.length });
  ranges.sort((x, y) => x.start - y.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start < prev.end) continue;
    merged.push(r);
  }
  return merged;
}

export function heroTitleWithHighlights(title: string, locale: string): ReactNode {
  const normalized = normalizeLocale(locale) ?? 'en-US';
  const ranges = rangesForTitle(title, normalized);
  if (ranges.length === 0) return title;

  const parts: ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (r.start > pos) {
      parts.push(<Fragment key={`t-${pos}-${r.start}`}>{title.slice(pos, r.start)}</Fragment>);
    }
    parts.push(
      <span className="mk-title-em" key={`e-${r.start}-${r.end}`}>
        {title.slice(r.start, r.end)}
      </span>
    );
    pos = r.end;
  }
  if (pos < title.length) {
    parts.push(<Fragment key={`t-${pos}-end`}>{title.slice(pos)}</Fragment>);
  }
  return <>{parts}</>;
}

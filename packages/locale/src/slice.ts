/**
 * Build a compact locale slice for LLM system prompt injection.
 * Targets ~200 tokens so it can live comfortably inside a larger prompt.
 */

import { getGlossary } from './glossary';
import type { CompactLocaleSlice } from './types';

const TOP_TERMS_LIMIT = 12;
const TOP_PHRASES_LIMIT = 6;

export function getLocaleSlice(localeOrCountry: string | null): CompactLocaleSlice {
  const g = getGlossary(localeOrCountry);
  return {
    locale: g.locale,
    country: g.country,
    language: g.language,
    currency: g.currency,
    chatLanguage: g.chatLanguage,
    preferredCarriers: g.preferredCarriers ?? [],
    topTerms: Object.entries(g.travelTerms).slice(0, TOP_TERMS_LIMIT),
    commonPhrases: Object.entries(g.commonPhrases).slice(0, TOP_PHRASES_LIMIT),
  };
}

/** Render the slice as a markdown-formatted prompt block. */
export function renderLocaleSlicePrompt(slice: CompactLocaleSlice): string {
  const lines = [
    `## Traveler locale: ${slice.locale} (${slice.language}) · currency ${slice.currency}`,
    `Respond in ${slice.chatLanguage}. Use local vocabulary.`,
    slice.preferredCarriers.length
      ? `Preferred carriers on this market: ${slice.preferredCarriers.join(', ')}.`
      : '',
    slice.topTerms.length
      ? `### Local travel vocabulary\n${slice.topTerms
          .map(([k, v]) => `- \`${k}\` — ${v}`)
          .join('\n')}`
      : '',
    slice.commonPhrases.length
      ? `### Common phrases → intent\n${slice.commonPhrases
          .map(([k, v]) => `- "${k}" → ${v}`)
          .join('\n')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

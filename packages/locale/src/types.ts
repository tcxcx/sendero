/**
 * Travel-domain locale glossary. Injected into LLM system prompts so the
 * agent speaks the traveler's dialect correctly (São Paulo BRL vs Lisbon
 * EUR, Mexican airline slang, UK cancellation vocabulary, etc.).
 */

export interface TravelGlossary {
  /** BCP-47 tag the glossary targets (e.g. `es-MX`, `pt-BR`). */
  locale: string;
  /** Country code (ISO 3166-1 alpha-2). */
  country: string;
  language: string;
  currency: string;
  /** Language used on machine outputs (RFC 5646). */
  chatLanguage: string;
  /** Common preferred carriers on this market, lowest-cost first. */
  preferredCarriers?: string[];
  /** Common seat / fare / trip vocabulary used by travelers. */
  travelTerms: Record<string, string>;
  /** Colloquial money / price expressions. */
  moneySlang?: Record<string, string>;
  /** Trip-stage phrases the agent should recognize and produce. */
  commonPhrases: Record<string, string>;
  /** Optional local loyalty programs travelers reference. */
  loyaltyPrograms?: string[];
}

/** Compact 200-token slice to inject into the LLM system prompt. */
export interface CompactLocaleSlice {
  locale: string;
  country: string;
  language: string;
  currency: string;
  chatLanguage: string;
  preferredCarriers: string[];
  topTerms: Array<[string, string]>;
  commonPhrases: Array<[string, string]>;
}

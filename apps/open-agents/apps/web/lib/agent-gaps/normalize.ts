/**
 * Hypothesis tokenization for dedup hashing + token-overlap matching.
 * Order-insensitive, stopword-aware. Pure utility (no DB access).
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "i",
  "we",
  "it",
  "this",
  "that",
  "these",
  "those",
  "as",
  "not",
  "no",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "has",
  "have",
  "had",
  "so",
  "than",
  "then",
]);

export function normalizeHypothesis(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !STOPWORDS.has(tok))
    .sort()
    .join(" ");
}

export function tokenSet(text: string): Set<string> {
  return new Set(normalizeHypothesis(text).split(" ").filter(Boolean));
}

/**
 * Self-heal preamble — direction B of the Sendero ↔ Minions seam.
 *
 * Before LLM dispatch, asks the Minions board "has a similar
 * hypothesis been resolved before?". On a hit, returns a markdown
 * block to prepend to the system prompt so the agent doesn't
 * re-investigate the same root cause turn after turn.
 *
 * Fail-soft contract:
 *   - Missing AGENT_GAPS_BASE_URL → null (loop not configured)
 *   - Missing AGENT_GAPS_INGEST_SECRET → null
 *   - Timeout (1.5s) → null
 *   - Non-2xx → null
 *   - Network error → null
 *
 * Never throws, never blocks the turn. Total upper bound on added
 * latency is the AbortController timeout below.
 */

const DEFAULT_TIMEOUT_MS = 1500;

export interface ResolvedGapHit {
  gapId: string;
  hypothesis: string;
  fixSummary: string | null;
  mustMention: string[];
  resolutionPrUrl: string | null;
  resolvedAt: string | null;
}

export interface FindResolvedResponse {
  hit: ResolvedGapHit | null;
  score?: number;
}

/**
 * Calls the Minions find-resolved endpoint with the given hypothesis
 * text. Returns the raw response or null when the lookup short-circuits
 * (no config, timeout, error). Exposed for tests; production callers
 * use buildSelfHealPreamble().
 */
export async function fetchResolvedGap(args: {
  hypothesis: string;
  toolName?: string;
  kind?: string;
  timeoutMs?: number;
}): Promise<FindResolvedResponse | null> {
  const baseUrl = process.env.AGENT_GAPS_BASE_URL;
  const secret = process.env.AGENT_GAPS_INGEST_SECRET;
  if (!baseUrl || !secret) return null;
  if (!args.hypothesis || args.hypothesis.trim().length === 0) return null;

  const url = new URL("/api/agent-gaps/find-resolved", baseUrl);
  url.searchParams.set("hypothesis", args.hypothesis);
  if (args.toolName) url.searchParams.set("toolName", args.toolName);
  if (args.kind) url.searchParams.set("kind", args.kind);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as FindResolvedResponse;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the markdown preamble block to prepend to the agent's system
 * prompt. Returns null on miss / config absent / error — caller should
 * just skip injection in that case.
 *
 * The hypothesis input is typically the latest user text, but callers
 * with a more focused failure-hypothesis string (e.g. a tool error
 * message) can pass that instead.
 */
export async function buildSelfHealPreamble(args: {
  hypothesis: string;
  toolName?: string;
  kind?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const result = await fetchResolvedGap(args);
  if (!result?.hit) return null;

  const { fixSummary, mustMention, resolutionPrUrl, hypothesis } = result.hit;
  if (!fixSummary) return null;

  const lines: string[] = [
    "## Known fix from prior run",
    "",
    `A similar hypothesis was resolved before: "${hypothesis}"`,
    "",
    `**Fix:** ${fixSummary}`,
  ];

  if (mustMention && mustMention.length > 0) {
    lines.push("");
    lines.push(`**Must mention:** ${mustMention.join(", ")}`);
  }

  if (resolutionPrUrl) {
    lines.push("");
    lines.push(`**Resolution PR:** ${resolutionPrUrl}`);
  }

  return lines.join("\n");
}

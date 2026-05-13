/**
 * Composable system-prompt builder for Sendero.
 *
 * Adapted from the desk-v1-whatsapp-channel pattern (intelligence/src/chat/
 * build-system-prompt). Sections are additive — consumers (chat route,
 * dispatch route, MCP server, Slack) pass only the slices they have.
 * The builder stitches them in a stable order with locale steering.
 *
 * The point: every channel ends up talking to the LLM with the *same*
 * structure — persona first, live runtime context second, trip snapshot
 * third, conversation recap last. Channel-specific framing (e.g. Slack
 * "use mrkdwn") lives in the `channelHint` slot so the engine never
 * grows a channel-branch.
 */

import { type CompactLocaleSlice, renderLocaleSlicePrompt } from '@sendero/locale';

export interface SystemPromptSections {
  /** Required: who the agent is and how it behaves. */
  persona: string;
  /** Traveler's BCP-47 locale — steers reply language. */
  locale?: string | null;
  /** Compact locale glossary slice from @sendero/locale. */
  localeSlice?: CompactLocaleSlice | null;
  /** Optional: short channel-shape hint (e.g. "Slack mrkdwn", "WhatsApp 1600-char limit"). */
  channelHint?: string;
  /** Live runtime context the dispatch / chat routes auto-inject each turn (JSON-stringified). */
  runtimeContext?: string;
  /** Current trip snapshot if we know which trip this turn is about. */
  tripContext?: string;
  /** Workflow catalog listing the named plans the agent can route to. */
  workflowCatalog?: string;
  /** Last ~6 turns rendered as `- role: text`. */
  recentTurns?: string;
  /** Tenant / booking policy surface if present (version + key rules). */
  policyContext?: string;
  /**
   * Per-turn attachment hint. Present only when the user message carries
   * a PDF / image / document; tells the agent to reach for the
   * `scan_document` tool rather than describing the file in prose.
   */
  attachmentsHint?: string;
  /**
   * Standing travel-document policy — always on.  Tells the agent when
   * to call `check_travel_eligibility` and, crucially, how to ask for
   * nationality conversationally instead of forcing a passport upload
   * every time.
   */
  travelDocumentHint?: string;
  /** Extra guidelines (confidence caveats, follow-up handling, etc.). */
  responseGuidelines?: string;
  /**
   * Self-heal preamble injected when a similar hypothesis has been
   * resolved before on the Minions agent-gaps board. Carries the prior
   * fix_summary + must_mention tokens so the agent doesn't
   * re-investigate the same root cause. Built by
   * `buildSelfHealPreamble()` against the Minions find-resolved seam.
   */
  selfHealPreamble?: string;
}

const DEFAULT_RESPONSE_GUIDELINES = `
## Response guidelines

- **Prefer named workflows over free-form tool chains.** If the user's
  intent matches a workflow in the catalog, call that workflow — do not
  re-implement it by stringing individual tools together. Workflows are
  the single source of truth for multi-step actions (search → policy →
  hold → confirm → settle), shared across chat, Slack, MCP, and edge.
- Only call raw tools directly when no workflow matches.
- Keep replies short unless the user asks a direct question.
- When calling a tool or workflow, say one sentence about why before
  the call.
- Never echo seed phrases, private keys, or passwords — even if asked.
- Prefer concrete next actions ("Hold seat", "Approve spend") over
  open-ended explanations.
- When the runtime context contains a recent error, address it directly
  and offer a concrete next step.`.trim();

export interface WorkflowListing {
  id: string;
  label: string;
  description?: string | null;
}

/**
 * Render the canonical "Workflows available" block. Accepts the
 * workflow listings so callers can filter by segment / policy without
 * this module taking a hard dep on `@sendero/workflows`.
 */
export function renderWorkflowsBlock(workflows: readonly WorkflowListing[]): string {
  if (workflows.length === 0) return '';
  return [
    '## Workflows available (prefer these over raw tool chains)',
    ...workflows.map(
      w => `- \`${w.id}\` — ${w.label}${w.description ? `\n    ${w.description}` : ''}`
    ),
  ].join('\n');
}

/**
 * BCP-47 → short reply-language steering line. Kept conservative —
 * the LLM picks up locale from the user's own messages, but a nudge
 * helps on the first turn.
 */
function localeSteering(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const lang = locale.toLowerCase().split('-')[0];
  switch (lang) {
    case 'es':
      return '## Idioma\n\nResponde al viajero en español rioplatense (tono cercano, voseo opcional).';
    case 'pt':
      return '## Idioma\n\nResponda ao viajante em português (pt-BR por padrão).';
    case 'fr':
      return '## Langue\n\nRéponds au voyageur en français.';
    case 'en':
      return '## Language\n\nReply to the traveler in English.';
    default:
      return `## Language\n\nReply in the traveler's own language (BCP-47: ${locale}).`;
  }
}

/**
 * Assemble the system prompt from the provided sections. Order is
 * stable so prompt caches stay warm — never reorder without a reason.
 */
export function buildSystemPrompt(sections: SystemPromptSections): string {
  const parts: string[] = [sections.persona.trim()];

  // Self-heal preamble injected first after persona so the agent sees
  // the prior-fix advisory before any live runtime context. The block
  // builder (buildSelfHealPreamble) already wraps in a heading + must-
  // mention list; we trust it verbatim here.
  if (sections.selfHealPreamble?.trim()) {
    parts.push(sections.selfHealPreamble.trim());
  }

  if (sections.localeSlice) {
    parts.push(renderLocaleSlicePrompt(sections.localeSlice));
  }

  const locale = localeSteering(sections.locale);
  if (locale) parts.push(locale);

  if (sections.channelHint?.trim()) {
    parts.push(`## Channel\n\n${sections.channelHint.trim()}`);
  }

  if (sections.runtimeContext?.trim()) {
    parts.push(
      `## Runtime context (live; reflect on it before replying)\n\n\`\`\`json\n${sections.runtimeContext.trim()}\n\`\`\``
    );
  }

  if (sections.tripContext?.trim()) {
    parts.push(`## Trip context\n\n${sections.tripContext.trim()}`);
  }

  if (sections.policyContext?.trim()) {
    parts.push(`## Policy\n\n${sections.policyContext.trim()}`);
  }

  if (sections.attachmentsHint?.trim()) {
    parts.push(`## Attachments\n\n${sections.attachmentsHint.trim()}`);
  }

  if (sections.travelDocumentHint?.trim()) {
    parts.push(sections.travelDocumentHint.trim());
  }

  if (sections.workflowCatalog?.trim()) {
    parts.push(sections.workflowCatalog.trim());
  }

  if (sections.recentTurns?.trim()) {
    parts.push(sections.recentTurns.trim());
  }

  parts.push(sections.responseGuidelines?.trim() ?? DEFAULT_RESPONSE_GUIDELINES);

  return parts.join('\n\n');
}

export { DEFAULT_RESPONSE_GUIDELINES };

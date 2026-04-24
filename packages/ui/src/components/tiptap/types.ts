/**
 * Shared types for the Sendero Support Writing Assistant — the tiptap
 * editor + bubble menu + AI rewrite menu used in the inbox composer.
 *
 * `RewriteMode` mirrors the actions exposed in the bubble menu. The
 * server-side `rewrite()` endpoint dispatches on these same modes, so
 * adding a mode means touching both files.
 */

export type RewriteMode =
  | 'grammar'
  | 'shorter'
  | 'warmer'
  | 'more_professional'
  | 'translate'
  | 'whatsapp'
  | 'explain_delay'
  | 'escalate';

export type SupportChannel = 'whatsapp' | 'slack' | 'email' | 'web' | 'internal' | 'mcp';

export interface RewriteContext {
  /** Traveler display name — lets the model personalize salutations. */
  customerName?: string;
  /** Free-form trip status blurb ("booked", "in disruption", "awaiting approval"). */
  tripStatus?: string;
  /** Delivery channel — shapes tone/length/format. */
  channel: SupportChannel;
  /** Brand voice description injected into the system prompt. */
  brandVoice?: string;
  /**
   * Traveler locale as BCP-47 (`es-MX`, `pt-BR`, `en-US`). The model
   * replies in this language for every mode except `translate`.
   */
  locale: string;
  /** Required when `mode === "translate"`. */
  targetLocale?: string;
}

export interface RewriteRequest {
  message: string;
  mode: RewriteMode;
  context: RewriteContext;
}

export interface RewriteResponse {
  output: string;
  mode: RewriteMode;
  /** Locale of the returned text — `targetLocale` for translate, else `context.locale`. */
  locale: string;
}

export type RewriteFn = (req: RewriteRequest) => Promise<RewriteResponse>;

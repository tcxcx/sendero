/**
 * Module-level singleton that lets non-chat surfaces (Stage SearchForm,
 * quick-command pills, HoldCard, FundCard) route a typed message
 * through whichever chat surface is currently mounted on the page
 * (chat-col on `/`, console-chat-host on `/dashboard/console`,
 * meta-inbox-live on `/dashboard/inbox/[tripId]`).
 *
 * Phase B-γ extends the surface with cleanup APIs:
 *   - unregisterChatBridge / unregisterChatNote / unregisterChatStatus
 *     so effect-scoped registration can clean up on unmount and avoid
 *     stale closures surviving past their host. Required by the
 *     ConsoleChatHost split (Codex outside-voice review #1).
 *   - registerChatStatus / getChatStatus so the demo-trip runner in
 *     @conversation can poll the host's useChat status without owning
 *     it (#4 of the same review).
 *
 * Module state is fine: this app only mounts one chat surface at a
 * time, and `sendMessage` from useChat is reference-stable so re-
 * registering on every render is idempotent. Surface IDs ('chat-col',
 * 'console', 'meta-inbox-live') gate the duplicate-registration warning
 * so same-surface re-registers don't spam in dev.
 */

type Send = (text: string) => void;
type Note = (text: string) => void;
type StatusGetter = () => string;

let registered: Send | null = null;
let registeredKey: unknown = null;
let registeredNote: Note | null = null;
let registeredNoteKey: unknown = null;
let registeredStatus: StatusGetter | null = null;
let registeredStatusKey: unknown = null;

/**
 * Register the active chat surface's send handler.
 *
 * `key` is the underlying reference-stable identity (e.g. useChat's
 * `sendMessage`) that the wrapper closes over. Same-surface re-registers
 * (same `key`) skip the duplicate-registration warning.
 */
export function registerChatBridge(send: Send, key?: unknown): void {
  const sameSurface = key !== undefined && registeredKey === key;
  if (registered && !sameSurface && registered !== send && process.env.NODE_ENV !== 'production') {
    console.warn(
      '[chat-bridge] sendMessage already registered — last write wins. ' +
        'Mount one chat surface at a time (chat-col OR console-chat-host OR meta-inbox-live).'
    );
  }
  registered = send;
  registeredKey = key ?? send;
}

/**
 * Effect-cleanup counterpart. Pass the same `key` used in register —
 * a different key means a newer surface already replaced this one and
 * we should not clear the new registration. (Codex #1: lifecycle-bound
 * registration that survives StrictMode dev double-mount.)
 */
export function unregisterChatBridge(key: unknown): void {
  if (registeredKey === key) {
    registered = null;
    registeredKey = null;
  }
}

/**
 * Send text through the active chat surface. Returns false when no
 * surface is registered (storybook, install/slack flows, OR Turbopack
 * HMR module-state mismatch where the bridge was reloaded but the
 * Zustand `hostReady` flag wasn't updated). Callers should surface a
 * user-visible error on `false` rather than silently dropping the
 * input — Codex outside-voice #2.
 */
export function sendViaChat(text: string): boolean {
  if (!registered) return false;
  registered(text);
  return true;
}

/**
 * Append a synthetic system message to the active chat without firing
 * a model round-trip. Stage's HoldCard / FundCard call this AFTER a
 * direct API call (e.g. /api/bookings/hold) succeeds so the chat
 * history stays coherent for follow-up turns ("what PNR did you
 * hold?") and survives reload — without the cost or non-determinism
 * of routing the action itself through the agent.
 *
 * Returns false when no chat is mounted (storybook, install/slack);
 * the caller's direct-API path remains the only effect in that case.
 */
export function registerChatNote(note: Note, key?: unknown): void {
  const sameSurface = key !== undefined && registeredNoteKey === key;
  if (
    registeredNote &&
    !sameSurface &&
    registeredNote !== note &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.warn('[chat-bridge] noteToChat already registered — last write wins.');
  }
  registeredNote = note;
  registeredNoteKey = key ?? note;
}

export function unregisterChatNote(key: unknown): void {
  if (registeredNoteKey === key) {
    registeredNote = null;
    registeredNoteKey = null;
  }
}

export function noteToChat(text: string): boolean {
  if (!registeredNote) return false;
  registeredNote(text);
  return true;
}

/**
 * Register a getter that returns the current useChat status string
 * ('submitted' | 'streaming' | 'ready' | 'error'). Used by the demo-
 * trip runner in `@conversation` to poll the layout-level
 * `ConsoleChatHost`'s status without crossing component-tree
 * boundaries via refs. (Codex outside-voice #4.)
 */
export function registerChatStatus(getter: StatusGetter, key?: unknown): void {
  const sameSurface = key !== undefined && registeredStatusKey === key;
  if (
    registeredStatus &&
    !sameSurface &&
    registeredStatus !== getter &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.warn('[chat-bridge] chat-status getter already registered — last write wins.');
  }
  registeredStatus = getter;
  registeredStatusKey = key ?? getter;
}

export function unregisterChatStatus(key: unknown): void {
  if (registeredStatusKey === key) {
    registeredStatus = null;
    registeredStatusKey = null;
  }
}

/** Returns the current chat status, or 'unknown' when no host is registered. */
export function getChatStatus(): string {
  if (!registeredStatus) return 'unknown';
  return registeredStatus();
}

/** True iff a chat surface is registered. Mirrors Zustand `hostReady`. */
export function chatBridgeReady(): boolean {
  return registered !== null;
}

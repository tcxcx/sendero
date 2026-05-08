/**
 * Module-level singleton that lets non-chat surfaces (Stage SearchForm,
 * quick-command pills) route a typed message through whichever chat
 * surface is currently mounted on the page (chat-col on `/`, meta-
 * inbox-live on `/dashboard/console`).
 *
 * Why not Zustand or Context?
 *   - Zustand needed a useEffect to register/cleanup; that re-renders
 *     subscribers on every mount/unmount and adds hook ceremony for
 *     a value that's stable for the lifetime of the chat surface.
 *   - Context would require lifting useChat above sendero-app.tsx,
 *     which is a sibling-of-Stage in that tree — bigger refactor.
 *
 * Module state is fine here: this app only ever mounts one chat at a
 * time, and `sendMessage` from useChat is reference-stable so re-
 * registering on every render is idempotent.
 */

type Send = (text: string) => void;
type Note = (text: string) => void;

let registered: Send | null = null;
let registeredKey: unknown = null;
let registeredNote: Note | null = null;
let registeredNoteKey: unknown = null;

/**
 * Register the active chat surface's send handler.
 *
 * The optional `key` is the underlying reference-stable identity (e.g.
 * useChat's `sendMessage`) that the wrapper closes over. Without a key,
 * callers like `(text) => sendMessage({ text })` create a fresh closure
 * every render — the equality check would always fail and the duplicate-
 * registration warning would spam in dev. The key lets us detect a *real*
 * surface swap (different useChat instance) versus a benign re-register
 * from the same surface during normal renders.
 */
export function registerChatBridge(send: Send, key?: unknown): void {
  const sameSurface = key !== undefined && registeredKey === key;
  if (registered && !sameSurface && registered !== send && process.env.NODE_ENV !== 'production') {
    console.warn(
      '[chat-bridge] sendMessage already registered — last write wins. ' +
        'Mount one chat surface at a time (chat-col OR meta-inbox-live).'
    );
  }
  registered = send;
  registeredKey = key ?? send;
}

export function sendViaChat(text: string): boolean {
  if (!registered) return false;
  registered(text);
  return true;
}

/**
 * Append a synthetic system message to the active chat without firing
 * a model round-trip. Stage's HoldCard / FundCard call this AFTER a
 * direct API call (e.g. /api/bookings/hold) succeeds, so the chat
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

export function noteToChat(text: string): boolean {
  if (!registeredNote) return false;
  registeredNote(text);
  return true;
}

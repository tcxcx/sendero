/**
 * Module-level singleton that lets non-chat surfaces (Stage SearchForm,
 * quick-command pills) route a typed message through whichever chat
 * surface is currently mounted on the page (chat-col on `/`, meta-
 * inbox-live on `/dashboard/console`, console-chat-host on the new
 * console surface).
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
 *
 * Surface keys
 *   `registerChat*` accepts an optional `surfaceKey`; `unregisterChat*`
 *   takes the same key. The key is used solely to make cleanup safe
 *   under StrictMode double-mount and surface-swap races: unregister
 *   only clears the slot if the current registrant matches the caller.
 *   Legacy single-arg call sites (meta-inbox-live) pass no key and
 *   keep their old "last-write-wins, no cleanup" behavior.
 */

type Send = (text: string) => void;
type Note = (text: string) => void;
type StatusGetter = () => unknown;

interface Slot<T> {
  fn: T;
  surfaceKey: string | null;
}

let bridge: Slot<Send> | null = null;
let noteSlot: Slot<Note> | null = null;
let statusSlot: Slot<StatusGetter> | null = null;

export function registerChatBridge(send: Send, surfaceKey: string | null = null): void {
  if (bridge && bridge.fn !== send && process.env.NODE_ENV !== 'production') {
    console.warn(
      '[chat-bridge] sendMessage already registered — last write wins. ' +
        'Mount one chat surface at a time (chat-col OR meta-inbox-live OR console).'
    );
  }
  bridge = { fn: send, surfaceKey };
}

export function unregisterChatBridge(surfaceKey: string | null = null): void {
  if (bridge && bridge.surfaceKey === surfaceKey) bridge = null;
}

export function sendViaChat(text: string): boolean {
  if (!bridge) return false;
  bridge.fn(text);
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
export function registerChatNote(note: Note, surfaceKey: string | null = null): void {
  if (noteSlot && noteSlot.fn !== note && process.env.NODE_ENV !== 'production') {
    console.warn('[chat-bridge] noteToChat already registered — last write wins.');
  }
  noteSlot = { fn: note, surfaceKey };
}

export function unregisterChatNote(surfaceKey: string | null = null): void {
  if (noteSlot && noteSlot.surfaceKey === surfaceKey) noteSlot = null;
}

export function noteToChat(text: string): boolean {
  if (!noteSlot) return false;
  noteSlot.fn(text);
  return true;
}

/**
 * Status getter — lets non-chat surfaces (e.g. the /demo trip runner)
 * poll the host's useChat `status` without subscribing. Host registers
 * a closure over a ref so reads are always fresh; consumers call
 * `getChatStatus()` which returns `undefined` when no host is mounted.
 */
export function registerChatStatus(
  getStatus: StatusGetter,
  surfaceKey: string | null = null
): void {
  if (statusSlot && statusSlot.fn !== getStatus && process.env.NODE_ENV !== 'production') {
    console.warn('[chat-bridge] chat-status getter already registered — last write wins.');
  }
  statusSlot = { fn: getStatus, surfaceKey };
}

export function unregisterChatStatus(surfaceKey: string | null = null): void {
  if (statusSlot && statusSlot.surfaceKey === surfaceKey) statusSlot = null;
}

export function getChatStatus(): unknown {
  return statusSlot?.fn();
}

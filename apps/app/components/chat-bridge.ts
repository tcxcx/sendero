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

let registered: Send | null = null;

export function registerChatBridge(send: Send): void {
  registered = send;
}

export function sendViaChat(text: string): boolean {
  if (!registered) return false;
  registered(text);
  return true;
}

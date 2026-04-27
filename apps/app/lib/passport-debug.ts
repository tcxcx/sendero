/**
 * Passport flow debug logger.
 *
 * Demo / development behavior is loud (every step logged). Production
 * behavior is silent — only `console.warn` and `console.error` (failure
 * paths) stay on across all environments.
 *
 * Toggle:
 *   - Server: `DEBUG_PASSPORT=1` (preferred). Falls back to
 *     `NEXT_PUBLIC_DEBUG_PASSPORT=1` if you want one knob for both
 *     halves of the stack.
 *   - Client: `NEXT_PUBLIC_DEBUG_PASSPORT=1` (build-time exposed) OR
 *     `localStorage.setItem('debug:passport', '1')` for ad-hoc
 *     reproduction without a rebuild.
 */

function isDebugEnabled(): boolean {
  // Server-side / Node: read from process.env directly.
  if (typeof window === 'undefined') {
    return (
      process.env.DEBUG_PASSPORT === '1' || process.env.NEXT_PUBLIC_DEBUG_PASSPORT === '1'
    );
  }
  // Client-side: build-time env var or runtime localStorage flag.
  if (process.env.NEXT_PUBLIC_DEBUG_PASSPORT === '1') return true;
  try {
    return window.localStorage.getItem('debug:passport') === '1';
  } catch {
    return false;
  }
}

export function passportLog(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log(...(args as Parameters<typeof console.log>));
}

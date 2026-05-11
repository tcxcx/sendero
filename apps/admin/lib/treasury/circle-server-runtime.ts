/**
 * Circle's modular transport is browser-first and reads `window.location`
 * while building its API headers. Admin treasury actions run as Next.js
 * server actions, but they use an EOA bootstrap signer, not WebAuthn.
 *
 * This shim provides only the location fields the transport needs. It
 * intentionally does not provide navigator/credentials, so any accidental
 * WebAuthn path still fails instead of silently pretending to work.
 */
export function ensureCircleServerRuntime() {
  if (typeof window !== 'undefined') return;

  const runtime = globalThis as unknown as {
    window?: { location: { hostname: string; protocol: string } };
  };

  runtime.window ??= {
    location: {
      hostname: process.env.NEXT_PUBLIC_APP_HOST ?? 'localhost',
      protocol: process.env.NODE_ENV === 'production' ? 'https:' : 'http:',
    },
  };
}

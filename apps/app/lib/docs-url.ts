/**
 * Resolve the canonical docs site origin per environment.
 *
 * In production, docs lives at `https://docs.sendero.travel`. In local
 * dev the docs app runs at `http://localhost:3020` (`apps/docs/package.json`
 * → `next dev -p 3020`). Hardcoding the prod URL on every page would
 * break dev — opening a "Security ↗" link on localhost would jump to
 * production and lose unsaved work in the docs source.
 *
 * Lookup order:
 *   1. `NEXT_PUBLIC_DOCS_URL` env (explicit override; honored everywhere).
 *   2. If running on localhost (NEXT_PUBLIC_APP_URL starts with http://localhost),
 *      default to `http://localhost:3020`.
 *   3. Otherwise, `https://docs.sendero.travel`.
 *
 * Returns an origin (no trailing slash). Pages compose the path:
 * `${docsOrigin()}/docs/security`.
 */

export function docsOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_DOCS_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (appUrl.startsWith('http://localhost')) return 'http://localhost:3020';
  return 'https://docs.sendero.travel';
}

export function docsUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${docsOrigin()}${normalized}`;
}

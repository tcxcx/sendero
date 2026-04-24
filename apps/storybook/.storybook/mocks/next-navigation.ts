const noop = () => {};

export function useRouter() {
  return {
    push: noop,
    replace: noop,
    refresh: noop,
    back: noop,
    forward: noop,
    prefetch: async () => {},
  };
}

export function usePathname() {
  return '/';
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}

export function useSelectedLayoutSegment() {
  return null;
}

export function useSelectedLayoutSegments() {
  return [];
}

export function redirect(url: string): never {
  if (typeof window !== 'undefined') {
    window.location.assign(url);
  }

  throw new Error(`Storybook redirect(${url})`);
}

export function permanentRedirect(url: string): never {
  return redirect(url);
}

export function notFound(): never {
  throw new Error('Storybook notFound()');
}

// Mirror Next's enum so transitive dependencies (e.g. @clerk/nextjs's
// keyless-actions) that destructure `RedirectType` don't crash the
// storybook bundle. Values are the real Next runtime strings so
// consumers can branch on them if they ever execute that path.
export const RedirectType = {
  push: 'push',
  replace: 'replace',
} as const;
export type RedirectType = (typeof RedirectType)[keyof typeof RedirectType];

export const ReadonlyURLSearchParams = URLSearchParams;

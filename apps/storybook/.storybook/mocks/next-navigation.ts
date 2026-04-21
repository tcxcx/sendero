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

export function notFound(): never {
  throw new Error('Storybook notFound()');
}

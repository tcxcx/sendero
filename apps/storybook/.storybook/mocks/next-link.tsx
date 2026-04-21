import * as React from 'react';

type Href =
  | string
  | {
      pathname?: string;
      query?: Record<string, string | number | boolean | null | undefined>;
      hash?: string;
    };

type StorybookLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: Href;
  as?: Href;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
};

function hrefToString(href: Href): string {
  if (typeof href === 'string') return href;

  const pathname = href.pathname ?? '/';
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value != null) query.set(key, String(value));
  }

  const queryString = query.toString();
  const hash = href.hash ? `#${href.hash.replace(/^#/, '')}` : '';
  return `${pathname}${queryString ? `?${queryString}` : ''}${hash}`;
}

const Link = React.forwardRef<HTMLAnchorElement, StorybookLinkProps>(
  (
    {
      href,
      as,
      replace: _replace,
      scroll: _scroll,
      shallow: _shallow,
      passHref: _passHref,
      prefetch: _prefetch,
      locale: _locale,
      legacyBehavior,
      children,
      ...props
    },
    ref
  ) => {
    const resolvedHref = hrefToString(as ?? href);

    if (legacyBehavior && React.isValidElement(children)) {
      return React.cloneElement(children, {
        href: resolvedHref,
        ref,
      } as React.AnchorHTMLAttributes<HTMLAnchorElement> & React.RefAttributes<HTMLAnchorElement>);
    }

    return (
      <a ref={ref} href={resolvedHref} {...props}>
        {children}
      </a>
    );
  }
);

Link.displayName = 'StorybookNextLink';

export default Link;

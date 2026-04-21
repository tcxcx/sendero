import { Button } from '@sendero/ui/button';
import Link from 'next/link';

export function PagePagination({
  page,
  totalPages,
  baseUrl,
  searchParams,
}: {
  page: number;
  totalPages: number;
  baseUrl: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  function urlFor(nextPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === 'page' || value === undefined) continue;
      params.set(key, Array.isArray(value) ? value[0] : value);
    }
    params.set('page', String(nextPage));
    return `${baseUrl}?${params.toString()}`;
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <PaginationButton
          disabled={page <= 1}
          href={urlFor(Math.max(1, page - 1))}
          label="Previous"
        />
        <PaginationButton
          disabled={page >= totalPages}
          href={urlFor(Math.min(totalPages, page + 1))}
          label="Next"
        />
      </div>
    </div>
  );
}

function PaginationButton({
  disabled,
  href,
  label,
}: {
  disabled: boolean;
  href: string;
  label: string;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  );
}

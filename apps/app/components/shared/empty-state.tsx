import { Button } from '@sendero/ui/button';
import Link from 'next/link';

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border p-12 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {cta ? (
        <Button asChild>
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

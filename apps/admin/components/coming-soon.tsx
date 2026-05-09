import Link from 'next/link';

import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ComingSoon({
  title,
  description,
  items = [],
}: {
  title: string;
  description: string;
  items?: string[];
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">
          Admin workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
          {description}
        </p>
      </div>
      <Card className="border-[color:var(--color-border)] shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Planned surface</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length ? (
            <div className="grid gap-2">
              {items.map(item => (
                <div
                  key={item}
                  className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/35 px-3 py-2 text-sm"
                >
                  {item}
                </div>
              ))}
            </div>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/dashboard/treasury">
              Open treasury
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

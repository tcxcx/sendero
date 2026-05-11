import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type ComingSoonItem = {
  label: string;
  detail: string;
};

export function ComingSoonScreen({
  title,
  eyebrow,
  description,
  icon: Icon = Clock,
  items,
}: {
  title: string;
  eyebrow: string;
  description: string;
  icon?: LucideIcon;
  items: ComingSoonItem[];
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-4xl items-center">
      <section className="w-full space-y-6">
        <div className="flex items-center gap-2 text-sm text-[color:var(--color-muted-foreground)]">
          <Icon className="h-4 w-4" />
          {eyebrow}
        </div>
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{description}</p>
        </div>
        <div className="overflow-hidden rounded-lg border bg-[color:var(--color-card)]">
          <table className="w-full text-sm">
            <tbody>
              {items.map(item => (
                <tr key={item.label} className="border-t first:border-t-0">
                  <td className="w-56 px-4 py-3 font-medium">{item.label}</td>
                  <td className="px-4 py-3 text-[color:var(--color-muted-foreground)]">
                    {item.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/tenants">
            Open Tenant Command Center
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
}

import Link from 'next/link';

import { ArrowRight, Building2, CircleDollarSign, WalletCards } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ACTIONS = [
  {
    title: 'Treasury lifecycle',
    description: 'Provision and verify Solana + Arc operating treasuries.',
    href: '/dashboard/treasury',
    icon: WalletCards,
  },
  {
    title: 'Tenant Command Center',
    description: 'Support, channel health, routing, and active tenant operations.',
    href: '/dashboard/tenants',
    icon: Building2,
  },
  {
    title: 'Billing rollups',
    description: 'SaaS MRR, included usage, transparent overages, and tool-level ledger views.',
    href: '/dashboard/billing',
    icon: CircleDollarSign,
  },
] as const;

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]">
            Sendero control plane
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Admin dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted-foreground)]">
            Manage vertical agents, tenant operations, payment rails, and support workflows from one
            internal workspace.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/treasury">
            Continue setup
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ACTIONS.map(action => {
          const Icon = action.icon;
          return (
            <Card key={action.href} className="border-[color:var(--color-border)] shadow-none">
              <CardHeader className="space-y-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-muted)]">
                  <Icon className="h-4 w-4" />
                </div>
                <CardTitle className="text-base">{action.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-[color:var(--color-muted-foreground)]">
                  {action.description}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href={action.href}>Open</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

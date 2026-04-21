import { OrganizationProfile } from '@clerk/nextjs';
import { Card, CardContent, CardHeader, CardTitle } from '@sendero/ui/card';
import { Badge } from '@sendero/ui/badge';
import { RetryButton } from '@/components/admin/retry-button';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

export default async function OrganizationSettingsPage() {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const wallets = await prisma.circleWallet.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, address: true, kind: true, chain: true, createdAt: true },
  });

  return (
    <main className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Tenant wallet provisioning</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Retry Circle wallet provisioning if onboarding completed without a tenant treasury
              wallet.
            </p>
          </div>
          <RetryButton kind="wallet-provision" label="Retry wallet provisioning" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {wallets.length > 0 ? (
            wallets.map(wallet => (
              <div key={wallet.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{wallet.kind}</Badge>
                <span className="font-mono text-xs">{wallet.address}</span>
                <span className="text-muted-foreground">{wallet.chain}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No tenant wallet has been provisioned yet.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: 'w-full max-w-4xl',
              cardBox: 'shadow-none border border-border',
            },
          }}
        />
      </div>
    </main>
  );
}

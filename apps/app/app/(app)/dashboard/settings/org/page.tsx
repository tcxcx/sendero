import { OrganizationProfile } from '@clerk/nextjs';
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
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
        <header className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
              Tenant wallet provisioning
            </h3>
            <p className="text-sm text-muted-foreground">
              Retry Circle wallet provisioning if onboarding completed without a tenant treasury
              wallet.
            </p>
          </div>
          <RetryButton kind="wallet-provision" label="Retry wallet provisioning" />
        </header>
        <div className="flex flex-col gap-2">
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
        </div>
      </section>

      <div className="flex justify-center">
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: 'w-full max-w-4xl',
              cardBox: 'shadow-[var(--shadow-md)] rounded-[var(--radius-lg)]',
            },
          }}
        />
      </div>
    </div>
  );
}

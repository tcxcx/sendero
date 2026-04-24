import { CapsForm } from '@/components/caps/caps-form';
import { CapsList } from '@/components/caps/caps-list';
import { requireRole } from '@/lib/require-role';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

export default async function CapsPage() {
  await requireRole('org:admin');
  const { tenant } = await requireCurrentTenant();
  const caps = await prisma.tenantSpendCap.findMany({
    where: { tenantId: tenant.id },
    orderBy: { period: 'asc' },
  });

  return (
    <div className="flex flex-col gap-6">
      <CapsList caps={caps} />
      <CapsForm />
    </div>
  );
}

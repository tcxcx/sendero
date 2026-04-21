import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app-shell/page-header';
import { TripDetailCard } from '@/components/trips/trip-detail-card';
import { requireCurrentTenant } from '@/lib/tenant-context';
import { prisma } from '@sendero/database';

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireCurrentTenant();
  const trip = await prisma.trip.findFirst({
    where: { id, tenantId: tenant.id },
    include: { bookings: { orderBy: { createdAt: 'desc' } } },
  });
  if (!trip) notFound();

  return (
    <>
      <PageHeader title="Trip detail" description="Guest invite, booking, and settlement state." />
      <TripDetailCard trip={trip} />
    </>
  );
}

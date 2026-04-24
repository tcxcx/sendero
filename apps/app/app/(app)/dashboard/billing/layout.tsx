import { requireAnyRole } from '@/lib/require-role';

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  await requireAnyRole(['org:admin', 'org:finance']);
  return <>{children}</>;
}

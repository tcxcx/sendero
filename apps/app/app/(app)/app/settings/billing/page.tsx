import { BillingSettingsForm } from '@/components/settings/billing-settings-form';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function BillingSettingsPage() {
  const { tenant } = await requireCurrentTenant();
  return <BillingSettingsForm tenant={tenant} />;
}

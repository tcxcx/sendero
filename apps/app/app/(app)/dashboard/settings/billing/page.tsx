import { CreditBadge } from '@/components/billing/credit-badge';
import { BillingSettingsForm } from '@/components/settings/billing-settings-form';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function BillingSettingsPage() {
  const { tenant } = await requireCurrentTenant();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Retrospective burn-down meter — shown only when the tenant has a
          credit grant. Renders null for free tier so the form is not
          preceded by an empty card. */}
      <CreditBadge variant="full" />
      <BillingSettingsForm tenant={tenant} />
    </div>
  );
}

import { Button } from '@sendero/ui/button';
import { Input } from '@sendero/ui/input';
import { Label } from '@sendero/ui/label';
import { updateTenantBillingAction } from '@/app/(app)/app/settings/actions';
import type { Tenant } from '@sendero/database';

export function BillingSettingsForm({ tenant }: { tenant: Tenant }) {
  return (
    <form action={updateTenantBillingAction} className="grid max-w-2xl gap-4">
      <Field label="Legal name" name="legalName" defaultValue={tenant.legalName ?? ''} />
      <Field
        label="Billing contact email"
        name="billingContactEmail"
        type="email"
        defaultValue={tenant.billingContactEmail ?? ''}
      />
      <Field label="Tax ID" name="taxId" defaultValue={tenant.taxId ?? ''} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Address line 1" name="addressLine1" />
        <Field label="Address line 2" name="addressLine2" />
        <Field label="City" name="city" />
        <Field label="Region" name="region" />
        <Field label="Postal code" name="postalCode" />
        <Field label="Country" name="country" defaultValue={tenant.fiscalCountry ?? ''} />
      </div>
      <Button type="submit" className="w-fit">
        Save billing
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue = '',
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} />
    </div>
  );
}

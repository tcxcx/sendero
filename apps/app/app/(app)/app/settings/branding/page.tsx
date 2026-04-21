import { Alert, AlertDescription, AlertTitle } from '@sendero/ui/alert';
import { BrandingSettingsForm } from '@/components/settings/branding-settings-form';
import { objectFromJson } from '@/lib/format';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function BrandingSettingsPage() {
  const { tenant } = await requireCurrentTenant();
  if (!['business', 'enterprise'].includes(tenant.billingTier)) {
    return (
      <Alert>
        <AlertTitle>Branding is not available on this tier</AlertTitle>
        <AlertDescription>
          Custom logos and colors require a business or enterprise tenant.
        </AlertDescription>
      </Alert>
    );
  }
  const colors = objectFromJson(tenant.brandColors);
  return (
    <BrandingSettingsForm
      logoUrl={tenant.brandLogoUrl}
      colors={{
        primary: typeof colors.primary === 'string' ? colors.primary : undefined,
        accent: typeof colors.accent === 'string' ? colors.accent : undefined,
        background: typeof colors.background === 'string' ? colors.background : undefined,
      }}
    />
  );
}

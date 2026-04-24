'use client';

import { Button } from '@sendero/ui/button';
import { Input } from '@sendero/ui/input';
import { Label } from '@sendero/ui/label';
import { updateTenantBrandingAction } from '@/app/(app)/dashboard/settings/actions';
import { useState, useTransition } from 'react';

export function BrandingSettingsForm({
  logoUrl,
  colors,
}: {
  logoUrl?: string | null;
  colors: { primary?: string; accent?: string; background?: string };
}) {
  const [pending, startTransition] = useTransition();
  const [currentLogo, setCurrentLogo] = useState(logoUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function uploadLogo(file: File | null) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const body = new FormData();
    body.set('file', file);
    const response = await fetch('/api/tenants/branding-logo', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    setUploading(false);
    if (!response.ok) {
      setMessage(String(data.error ?? 'Logo upload failed'));
      return;
    }
    setCurrentLogo(String(data.url));
  }

  function submit(formData: FormData) {
    setMessage(null);
    formData.set('brandLogoUrl', currentLogo);
    startTransition(async () => {
      const result = await updateTenantBrandingAction(formData);
      setMessage('error' in result ? result.error : 'Branding saved.');
    });
  }

  return (
    <form action={submit} className="grid max-w-2xl gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="logo">Logo</Label>
        <Input
          id="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={event => uploadLogo(event.currentTarget.files?.[0] ?? null)}
        />
        {uploading ? <p className="text-sm text-muted-foreground">Uploading...</p> : null}
        {currentLogo ? (
          <div className="break-all rounded-md bg-muted p-3 text-xs">{currentLogo}</div>
        ) : null}
      </div>
      <ColorField label="Primary" name="primary" defaultValue={colors.primary ?? '#fb542b'} />
      <ColorField label="Accent" name="accent" defaultValue={colors.accent ?? '#111111'} />
      <ColorField
        label="Background"
        name="background"
        defaultValue={colors.background ?? '#ffffff'}
      />
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button type="submit" disabled={pending || uploading} className="w-fit">
        {pending ? 'Saving...' : 'Save branding'}
      </Button>
    </form>
  );
}

function ColorField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          name={name}
          type="color"
          defaultValue={defaultValue}
          className="w-16 p-1"
        />
        <Input name={`${name}Hex`} defaultValue={defaultValue} pattern="^#[0-9a-fA-F]{6}$" />
      </div>
    </div>
  );
}

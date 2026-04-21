import { PageHeader } from '@/components/app-shell/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';
import { requireRole } from '@/lib/require-role';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('org:admin');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Manage billing, branding, and profile details." />
      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsNav />
        <section className="min-w-0 flex-1">{children}</section>
      </div>
    </div>
  );
}

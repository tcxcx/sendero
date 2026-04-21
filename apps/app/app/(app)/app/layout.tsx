import { RedirectToTasks } from '@clerk/nextjs';
import { Toaster } from '@sendero/ui/sonner';
import { AppHeader } from '@/components/app-shell/app-header';
import { Sidebar } from '@/components/app-shell/sidebar';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  await requireCurrentTenant();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RedirectToTasks />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

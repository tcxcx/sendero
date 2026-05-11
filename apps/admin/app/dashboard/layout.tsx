import { redirect } from 'next/navigation';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { AdminCommandPalette } from '@/components/layout/admin-command-palette';
import { DashboardBreadcrumbs } from '@/components/layout/dashboard-breadcrumbs';
import { SearchTrigger } from '@/components/layout/search-trigger';
import { UserMenu } from '@/components/layout/user-menu';
import { WalletConnectButton } from '@/components/solana/wallet-button';
import { SolanaWalletProvider } from '@/components/solana/wallet-provider';
import { ThemeModeToggle } from '@/components/theme-mode-toggle';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { getPlatformRoles } from '@/lib/access';

import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * Dashboard shell — gates `/dashboard/*` to authenticated callers
 * with at least one platform role. Per-page guards (via
 * `requirePlatformRole`) restrict further. Phase 7.3 swaps the
 * minimal Phase-7.0 chrome for the polished shadcn shell.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const roles = await getPlatformRoles();
  if (roles.length === 0) redirect('/unauthorized');

  return (
    <SolanaWalletProvider>
      <SidebarProvider>
        <div className="flex min-h-screen">
          <AppSidebar roles={roles} />
          <SidebarInset>
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 bg-[color:var(--color-background)]/70 px-4 backdrop-blur-md">
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mr-2 hidden h-4 lg:block" />
                <DashboardBreadcrumbs />
              </div>
              <div className="flex items-center gap-2">
                <SearchTrigger />
                <WalletConnectButton />
                <ThemeModeToggle />
                <UserMenu />
              </div>
            </header>
            <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
            <AdminCommandPalette />
          </SidebarInset>
        </div>
      </SidebarProvider>
    </SolanaWalletProvider>
  );
}

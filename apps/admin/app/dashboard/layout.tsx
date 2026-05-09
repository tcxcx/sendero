import { redirect } from 'next/navigation';

import { UserButton } from '@clerk/nextjs';

import { AdminCommandPalette } from '@/components/admin-command-palette';
import { AppSidebar } from '@/components/layout/app-sidebar';
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
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-[color:var(--color-background)] px-4 lg:px-6">
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-6 lg:hidden" />
              <div className="flex-1" />
              <AdminCommandPalette />
              <WalletConnectButton />
              <ThemeModeToggle />
              <UserButton />
            </header>
            <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </SolanaWalletProvider>
  );
}

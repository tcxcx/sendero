'use client';

import { useEffect } from 'react';

import { usePathname } from 'next/navigation';

import { cn } from '@sendero/ui/cn';
import { TooltipProvider } from '@sendero/ui/tooltip';

import { AppHeader } from '@/components/app-shell/app-header';
import { AppShellFooter } from '@/components/app-shell/app-shell-footer';
import { DashboardBreadcrumb } from '@/components/app-shell/dashboard-breadcrumb';
import { DashboardPageHeader } from '@/components/app-shell/dashboard-page-header';
import { AppSidebar } from '@/components/app-sidebar';
import { BridgeDialog } from '@/components/bridge-dialog';
import { ClerkWalletBridge } from '@/components/clerk-wallet-bridge';
import { DepositDialog } from '@/components/deposit-dialog';
import { SendDialog } from '@/components/send-dialog';
import { hydrateFromStorage } from '@/components/store';
import { SwapDialog } from '@/components/swap-dialog';
import { useAppHotkeys } from '@/components/use-app-hotkeys';
import { useArcChainStream } from '@/components/use-arc-chain-stream';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

type ShellHeaderCopy = {
  signIn: string;
  getStarted: string;
};

export function AppChrome({
  children,
  headerCopy,
  locale,
  defaultSidebarOpen = true,
}: {
  children: React.ReactNode;
  headerCopy: ShellHeaderCopy;
  locale: string;
  defaultSidebarOpen?: boolean;
}) {
  const pathname = usePathname() ?? '';

  useEffect(() => {
    hydrateFromStorage();
  }, []);

  useArcChainStream();
  useAppHotkeys();

  const mainPad =
    pathname === '/dashboard/inbox' ||
    pathname.startsWith('/dashboard/inbox/') ||
    pathname.startsWith('/dashboard/console')
      ? 'p-0'
      : 'px-6 pb-6 pt-0';

  const mainFlex = pathname.startsWith('/dashboard/console') ? 'flex min-h-0 flex-1 flex-col' : '';

  return (
    <div className="app-shell-root flex h-svh w-full flex-col">
      <ClerkWalletBridge />
      <TooltipProvider delayDuration={120} skipDelayDuration={300}>
        <SidebarProvider className="min-h-0 flex-1" defaultOpen={defaultSidebarOpen}>
          <AppSidebar />
          {/* DESIGN.md §12 — the main content surface floats as a single
            raised card on the grainy gradient. Margin on ≥lg, rounded
            `--radius-xl`, `--shadow-xl`, and `--surface-raised` fill. */}
          <SidebarInset
            className="min-h-0 md:mt-4 md:mr-4 md:mb-4 md:rounded-tl-[36px] md:rounded-tr-[20px] md:rounded-bl-[20px] md:rounded-br-[20px] md:bg-[color:var(--surface-raised)] md:shadow-[var(--shadow-xl)] md:border-2"
            style={{ borderColor: 'color-mix(in oklab, var(--ink) 55%, transparent)' }}
          >
            <AppHeader
              copy={headerCopy}
              locale={locale}
              startSlot={<SidebarTrigger className="-ml-1 shrink-0" aria-label="Toggle sidebar" />}
            />
            <DashboardBreadcrumb />
            <DashboardPageHeader />
            <main
              className={cn('app-shell-main min-h-0 flex-1 overflow-auto my-2', mainPad, mainFlex)}
            >
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      <AppShellFooter />
      <SwapDialog />
      <SendDialog />
      <BridgeDialog />
      <DepositDialog />
    </div>
  );
}

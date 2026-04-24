'use client';

import { useEffect } from 'react';

import { usePathname } from 'next/navigation';

import { cn } from '@sendero/ui/cn';

import { AppHeader } from '@/components/app-shell/app-header';
import { AppShellFooter } from '@/components/app-shell/app-shell-footer';
import { AppSidebar } from '@/components/app-sidebar';
import { hydrateFromStorage } from '@/components/store';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

type ShellHeaderCopy = {
  signIn: string;
  getStarted: string;
};

export function AppChrome({
  children,
  headerCopy,
  locale,
}: {
  children: React.ReactNode;
  headerCopy: ShellHeaderCopy;
  locale: string;
}) {
  const pathname = usePathname() ?? '';

  useEffect(() => {
    hydrateFromStorage();
  }, []);

  const mainPad =
    pathname === '/app/inbox' ||
    pathname.startsWith('/app/inbox/') ||
    pathname.startsWith('/app/console')
      ? 'p-0'
      : 'p-6';

  const mainFlex = pathname.startsWith('/app/console') ? 'flex min-h-0 flex-1 flex-col' : '';

  return (
    <div className="app-shell-root flex min-h-svh w-full flex-col">
      <SidebarProvider className="min-h-0 flex-1">
        <AppSidebar />
        <SidebarInset>
          <AppHeader
            copy={headerCopy}
            locale={locale}
            startSlot={<SidebarTrigger className="-ml-1 shrink-0" aria-label="Toggle sidebar" />}
          />
          <main className={cn('app-shell-main flex-1', mainPad, mainFlex)}>{children}</main>
        </SidebarInset>
      </SidebarProvider>
      <AppShellFooter />
    </div>
  );
}

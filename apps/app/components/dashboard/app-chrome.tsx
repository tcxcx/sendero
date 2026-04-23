'use client';

import { usePathname } from 'next/navigation';

import { AppHeader } from '@/components/app-shell/app-header';
import { MainAppSidebar } from '@/components/dashboard/main-app-sidebar';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@sendero/ui/cn';

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

  const mainPad =
    pathname === '/app/inbox' ||
    pathname.startsWith('/app/inbox/') ||
    pathname.startsWith('/app/console')
      ? 'p-0'
      : 'p-6';

  const mainFlex = pathname.startsWith('/app/console') ? 'flex min-h-0 flex-1 flex-col' : '';

  return (
    <SidebarProvider>
      <MainAppSidebar />
      <SidebarInset>
        <AppHeader
          copy={headerCopy}
          locale={locale}
          startSlot={<SidebarTrigger className="-ml-1 shrink-0" aria-label="Toggle sidebar" />}
        />
        <main className={cn('app-shell-main flex-1', mainPad, mainFlex)}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

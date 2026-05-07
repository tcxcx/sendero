/**
 * Slim sidebar primitive for the Sendero admin app — a deliberately
 * lighter alternative to shadcn's 693-line ui/sidebar. Covers what
 * we need (collapsible-on-mobile, fixed-on-desktop, sticky
 * header/footer slots, simple menu items) and nothing more. Phase
 * 7.4+ may swap this for the full shadcn primitive if/when we need
 * sub-menus, group rails, or tooltip-on-collapsed.
 */
'use client';

import * as React from 'react';
import { Menu } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from './button';

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within <SidebarProvider>');
  return ctx;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <SidebarContext.Provider value={{ open, setOpen }}>{children}</SidebarContext.Provider>
  );
}

/**
 * Sidebar root. Always-visible 240px column on lg+; off-canvas
 * drawer on smaller screens (toggle via SidebarTrigger). Backdrop
 * dismisses the mobile drawer.
 */
export function Sidebar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { open, setOpen } = useSidebar();
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen w-60 flex-col border-r bg-[color:var(--color-sidebar)] text-[color:var(--color-sidebar-foreground)] transition-transform lg:sticky lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          className
        )}
      >
        {children}
      </aside>
    </>
  );
}

export function SidebarHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex h-14 items-center border-b px-4', className)}>{children}</div>
  );
}

export function SidebarContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-2 py-3', className)}>{children}</div>
  );
}

export function SidebarFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('border-t px-4 py-3', className)}>{children}</div>
  );
}

export function SidebarMenu({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <ul className={cn('flex flex-col gap-1', className)}>{children}</ul>;
}

export function SidebarMenuItem({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <li className={cn('list-none', className)}>{children}</li>;
}

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  /** Render as a `<span>` instead of `<button>` so consumers can wrap
   *  in a `<Link>`. The clickable surface is the parent in that case. */
  asChild?: boolean;
}

export const SidebarMenuButton = React.forwardRef<HTMLElement, SidebarMenuButtonProps>(
  ({ className, isActive, asChild, children, ...props }, ref) => {
    if (asChild) {
      return (
        <span
          ref={ref as React.Ref<HTMLSpanElement>}
          className={cn(menuItemClasses(isActive), className)}
        >
          {children}
        </span>
      );
    }
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={cn(menuItemClasses(isActive), className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

function menuItemClasses(isActive?: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-[color:var(--color-sidebar-accent)] text-[color:var(--color-sidebar-accent-foreground)]'
      : 'hover:bg-[color:var(--color-sidebar-accent)] hover:text-[color:var(--color-sidebar-accent-foreground)]'
  );
}

/** Hamburger trigger — only visible below `lg`. */
export function SidebarTrigger({ className }: { className?: string }) {
  const { open, setOpen } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('lg:hidden', className)}
      onClick={() => setOpen(!open)}
      aria-label="Toggle sidebar"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}

/** Container for the page content next to the sidebar. */
export function SidebarInset({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-h-screen flex-1 flex-col lg:pl-0', className)}>
      {children}
    </div>
  );
}

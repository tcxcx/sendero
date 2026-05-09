'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COMMANDS = [
  { label: 'Overview', href: '/dashboard', group: 'Admin' },
  { label: 'Treasury', href: '/dashboard/treasury', group: 'Operations' },
  { label: 'Contracts', href: '/dashboard/contracts', group: 'Operations' },
  { label: 'Payouts', href: '/dashboard/payouts', group: 'Finance' },
  { label: 'Billing', href: '/dashboard/billing', group: 'Finance' },
  { label: 'Pipeline', href: '/dashboard/pipeline', group: 'Growth' },
  { label: 'Tenants', href: '/dashboard/tenants', group: 'Support' },
  { label: 'Agents', href: '/dashboard/agents', group: 'Platform' },
  { label: 'Health', href: '/dashboard/health', group: 'Platform' },
] as const;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(value => !value);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = COMMANDS.filter(command => {
    const haystack = `${command.group} ${command.label}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="hidden h-9 w-[260px] justify-start gap-2 rounded-md border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 text-sm font-normal text-[color:var(--color-muted-foreground)] shadow-none md:inline-flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-muted)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
          ⌘ K
        </kbd>
      </Button>
      {open ? (
        <button
          type="button"
          aria-label="Close command palette"
          className="fixed inset-0 z-50 bg-black/25 p-4 backdrop-blur-[1px]"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="mx-auto mt-[12vh] max-w-xl overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-popover)] shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Admin command palette"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-3">
              <Search className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
              <input
                ref={el => el?.focus()}
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') setOpen(false);
                  if (event.key === 'Enter' && filtered[0]) navigate(filtered[0].href);
                }}
                placeholder="Search admin routes..."
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--color-muted-foreground)]"
              />
              <button
                type="button"
                className="rounded p-1 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-accent-foreground)]"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {filtered.length ? (
                filtered.map((command, index) => (
                  <button
                    key={command.href}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm',
                      'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-accent-foreground)]',
                      index === 0 && 'bg-[color:var(--color-accent)]'
                    )}
                    onClick={() => navigate(command.href)}
                  >
                    <span className="font-medium">{command.label}</span>
                    <span className="text-xs text-[color:var(--color-muted-foreground)]">
                      {command.group}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-8 text-center text-sm text-[color:var(--color-muted-foreground)]">
                  No admin route found.
                </div>
              )}
            </div>
          </div>
        </button>
      ) : null}
    </>
  );
}

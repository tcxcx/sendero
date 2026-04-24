'use client';

/**
 * Command-palette body: cmdk Command + debounced fetch against
 * /api/dashboard/search. Rendered inside a Radix Popover anchored to
 * the sidebar SearchForm button (see search-form.tsx). Hover-opens,
 * click-opens, ⌘K / Ctrl+K opens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bot,
  FileText,
  Home,
  Inbox,
  KeyRound,
  Landmark,
  MessageCircle,
  Plane,
  ScanLine,
  Settings,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useIsMac } from '@/components/hooks/use-is-mac';
import type { SearchResponse, SearchResult } from '@/app/api/dashboard/search/route';

type NavRoute = { title: string; href: string; keywords: string; icon: LucideIcon };

const NAV_ROUTES: NavRoute[] = [
  { title: 'Home', href: '/dashboard', keywords: 'home dashboard', icon: Home },
  { title: 'Agent console', href: '/dashboard/console', keywords: 'agent console chat', icon: Bot },
  {
    title: 'Scan document',
    href: '/dashboard/scan',
    keywords: 'scan document ocr',
    icon: ScanLine,
  },
  {
    title: 'Trip inboxes',
    href: '/dashboard/inbox',
    keywords: 'inbox messages threads',
    icon: Inbox,
  },
  { title: 'Trips', href: '/dashboard/trips', keywords: 'trips itineraries bookings', icon: Plane },
  {
    title: 'Invoices',
    href: '/dashboard/billing/invoices',
    keywords: 'invoices billing receipts',
    icon: FileText,
  },
  { title: 'Spend', href: '/dashboard/spend', keywords: 'spend usage budget', icon: BarChart3 },
  { title: 'Caps', href: '/dashboard/caps', keywords: 'caps limits spend-caps', icon: ShieldAlert },
  {
    title: 'WhatsApp channel',
    href: '/dashboard/channels/whatsapp',
    keywords: 'whatsapp channel kapso',
    icon: MessageCircle,
  },
  {
    title: 'Slack channel',
    href: '/dashboard/channels/slack',
    keywords: 'slack channel',
    icon: Landmark,
  },
  {
    title: 'MCP / LLM tools',
    href: '/dashboard/integrations/mcp',
    keywords: 'mcp llm tools integrations',
    icon: Sparkles,
  },
  {
    title: 'API keys',
    href: '/dashboard/settings/api-keys',
    keywords: 'api keys tokens auth',
    icon: KeyRound,
  },
  {
    title: 'Billing settings',
    href: '/dashboard/settings/billing',
    keywords: 'billing plan subscription',
    icon: Settings,
  },
];

type PaletteBodyProps = {
  onClose: () => void;
};

export function SearchPaletteBody({ onClose }: PaletteBodyProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 1) {
      setResults(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard/search?q=${encodeURIComponent(q)}&limit=6`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SearchResponse;
        setResults(json);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[search-palette] fetch failed', err);
          setResults({ trips: [], invoices: [], bookings: [], channels: [] });
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query]);

  const navMatches = useMemo<NavRoute[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return NAV_ROUTES;
    return NAV_ROUTES.filter(r => (r.title + ' ' + r.keywords).toLowerCase().includes(q));
  }, [query]);

  const hasAnyDbResults = useMemo(() => {
    if (!results) return false;
    return (
      results.trips.length > 0 ||
      results.invoices.length > 0 ||
      results.bookings.length > 0 ||
      results.channels.length > 0
    );
  }, [results]);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      onClose();
    },
    [router, onClose]
  );

  return (
    <Command
      shouldFilter={false}
      className={[
        'rounded-[18px] bg-transparent',
        // Input wrapper — vermillion hairline instead of the default dark border
        '[&_[cmdk-input-wrapper]]:border-b-[color:color-mix(in_oklab,var(--ink)_18%,transparent)]',
        '[&_[cmdk-input-wrapper]]:px-4',
        // Input itself — roomier, mono placeholder
        '[&_[cmdk-input]]:h-12 [&_[cmdk-input]]:text-[14px] [&_[cmdk-input]]:placeholder:font-mono [&_[cmdk-input]]:placeholder:tracking-[0.02em]',
        // Group headings — mono uppercase editorial
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-[color:color-mix(in_oklab,var(--sendero-midnight,#1F2A44)_55%,transparent)]',
        // Items — breathier, vermillion selected state
        '[&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2 [&_[cmdk-item]]:rounded-[8px] [&_[cmdk-item]]:gap-2.5',
        '[&_[cmdk-item][data-selected=true]]:bg-[color:var(--tint-vermillion-soft,rgba(214,84,56,0.10))]',
        '[&_[cmdk-item][data-selected=true]]:text-[color:var(--ink)]',
        // Separator — hairline ink
        '[&_[cmdk-separator]]:bg-[color:color-mix(in_oklab,var(--ink)_14%,transparent)]',
        // Group padding
        '[&_[cmdk-group]]:px-2 [&_[cmdk-group]]:py-1',
      ].join(' ')}
    >
      <CommandInput
        placeholder="Search trips, invoices, pages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>
          {loading ? (
            <span className="font-mono text-xs tracking-wide text-muted-foreground">
              Searching…
            </span>
          ) : query.trim().length === 0 ? (
            <span className="font-mono text-xs tracking-wide text-muted-foreground">
              Type to search trips, invoices, bookings, channels, or pages.
            </span>
          ) : (
            <span className="font-mono text-xs tracking-wide">
              <span style={{ color: 'var(--ink)' }}>No matches</span>{' '}
              <span className="text-muted-foreground">for &ldquo;{query}&rdquo;.</span>
            </span>
          )}
        </CommandEmpty>

        {navMatches.length > 0 && (
          <CommandGroup heading="Pages">
            {navMatches.map(route => (
              <CommandItem
                key={route.href}
                value={`${route.title} ${route.keywords}`}
                onSelect={() => go(route.href)}
              >
                <route.icon className="size-4 shrink-0 text-[color:var(--ink)]" />
                <span>{route.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hasAnyDbResults && <CommandSeparator />}

        {results && results.trips.length > 0 && (
          <CommandGroup heading="Trips">
            {results.trips.map(r => (
              <ResultItem key={r.id} result={r} icon={Plane} onSelect={go} />
            ))}
          </CommandGroup>
        )}
        {results && results.invoices.length > 0 && (
          <CommandGroup heading="Invoices">
            {results.invoices.map(r => (
              <ResultItem key={r.id} result={r} icon={FileText} onSelect={go} />
            ))}
          </CommandGroup>
        )}
        {results && results.bookings.length > 0 && (
          <CommandGroup heading="Bookings">
            {results.bookings.map(r => (
              <ResultItem key={r.id} result={r} icon={Plane} onSelect={go} />
            ))}
          </CommandGroup>
        )}
        {results && results.channels.length > 0 && (
          <CommandGroup heading="Channels">
            {results.channels.map(r => (
              <ResultItem key={r.id} result={r} icon={MessageCircle} onSelect={go} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function ResultItem({
  result,
  icon: Icon,
  onSelect,
}: {
  result: SearchResult;
  icon: LucideIcon;
  onSelect: (href: string) => void;
}) {
  return (
    <CommandItem
      value={`${result.title} ${result.subtitle ?? ''} ${result.id}`}
      onSelect={() => onSelect(result.href)}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{result.title}</span>
        {result.subtitle && (
          <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
        )}
      </div>
    </CommandItem>
  );
}

/**
 * Global hotkey wiring. Mount once at the layout root. Listens for
 * ⌘K / Ctrl+K and toggles an external state.
 */
export function useSearchHotkey(setOpen: (open: boolean) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

/** Platform-aware shortcut badge: "⌘K" on Mac, "Ctrl K" elsewhere. */
export function SearchShortcutHint({ className }: { className?: string }) {
  const isMac = useIsMac();
  return (
    <kbd
      className={
        'pointer-events-none inline-flex items-center gap-0.5 rounded-[5px] border border-[color:var(--border)] bg-[color:var(--surface-base)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground ' +
        (className ?? '')
      }
    >
      {isMac ? <span>⌘</span> : <span>Ctrl</span>}
      <span>K</span>
    </kbd>
  );
}

/**
 * Vermillion-tinted glassmorphism backdrop. Rendered as a portal-ed
 * fixed overlay when the palette is open. Shades out the dashboard
 * behind so the floating combobox reads as focused.
 */
export function SearchBackdrop({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40"
      style={{
        background: 'color-mix(in oklab, var(--ink) 14%, transparent)',
        backdropFilter: 'blur(10px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(10px) saturate(1.2)',
        animation: 'search-backdrop-in 180ms ease-out forwards',
      }}
    />
  );
}

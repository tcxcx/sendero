'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Building2,
  CircleDollarSign,
  HardDriveDownload,
  Heart,
  LayoutDashboard,
  MapIcon,
  Moon,
  Palette,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
  Sun,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

const COMMAND_PALETTE_EVENT = 'sendero:admin-command-palette';

type AdminCommand = {
  id: string;
  label: string;
  description: string;
  section: 'Navigate' | 'Create' | 'Theme';
  keywords: string;
  icon: LucideIcon;
  shortcut?: string;
  run: (ctx: CommandContext) => void;
};

type CommandContext = {
  push: (href: string) => void;
  setTheme: ReturnType<typeof useTheme>['setTheme'];
  setPlatformTheme: ReturnType<typeof useTheme>['setPlatformTheme'];
  resolvedTheme: ReturnType<typeof useTheme>['resolvedTheme'];
  platformTheme: ReturnType<typeof useTheme>['platformTheme'];
};

const NAV_COMMANDS: readonly Omit<AdminCommand, 'run'>[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Platform revenue, bookings, tenants, and health signals',
    section: 'Navigate',
    keywords: 'overview metrics charts revenue booking sales',
    icon: LayoutDashboard,
    shortcut: 'G D',
  },
  {
    id: 'treasury',
    label: 'Treasury',
    description: 'Solana Squads and Arc MSCA treasury lifecycle',
    section: 'Navigate',
    keywords: 'wallet msca arc solana multisig funds',
    icon: Wallet,
    shortcut: 'G T',
  },
  {
    id: 'tenants',
    label: 'Tenants',
    description: 'Tenant Command Center and support context',
    section: 'Navigate',
    keywords: 'customers orgs businesses support command center',
    icon: Users,
    shortcut: 'G C',
  },
  {
    id: 'maps',
    label: 'Maps',
    description: 'Tenant activity, active travelers, and route operations',
    section: 'Navigate',
    keywords: 'map trips active users travelers route logistics',
    icon: MapIcon,
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'SaaS MRR, usage overages, nanopay ledger rollups',
    section: 'Navigate',
    keywords: 'mrr invoices usage nanopay payments ledger',
    icon: CircleDollarSign,
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Sales pipeline for vertical AI agent opportunities',
    section: 'Navigate',
    keywords: 'sales deals prospects vertical agents',
    icon: TrendingUp,
  },
  {
    id: 'payouts',
    label: 'Payouts',
    description: 'Settlement and payout operations',
    section: 'Navigate',
    keywords: 'settlement payouts finance supplier',
    icon: HardDriveDownload,
  },
  {
    id: 'contracts',
    label: 'Contracts',
    description: 'Smart-contract and proposal operations',
    section: 'Navigate',
    keywords: 'contracts proposals governance phase',
    icon: ScanLine,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Vertical AI agent registry and operating status',
    section: 'Navigate',
    keywords: 'ai agents tools verticals registry',
    icon: Activity,
  },
  {
    id: 'health',
    label: 'Health',
    description: 'Platform checks, channel status, and incident signals',
    section: 'Navigate',
    keywords: 'status incidents checks channels observability',
    icon: Heart,
  },
] as const;

const ROUTES: Record<(typeof NAV_COMMANDS)[number]['id'], string> = {
  dashboard: '/dashboard',
  treasury: '/dashboard/treasury',
  tenants: '/dashboard/tenants',
  maps: '/dashboard/maps',
  billing: '/dashboard/billing',
  pipeline: '/dashboard/pipeline',
  payouts: '/dashboard/payouts',
  contracts: '/dashboard/contracts',
  agents: '/dashboard/agents',
  health: '/dashboard/health',
};

function buildCommands(ctx: CommandContext): AdminCommand[] {
  return [
    ...NAV_COMMANDS.map(command => ({
      ...command,
      run: ({ push }: CommandContext) => push(ROUTES[command.id]),
    })),
    {
      id: 'new-vertical-org',
      label: 'New vertical org',
      description: 'Create a new vertical AI agent business unit',
      section: 'Create',
      keywords: 'new org vertical business unit agent',
      icon: Plus,
      shortcut: 'N O',
      run: ({ push }) => push('/dashboard/orgs/new'),
    },
    {
      id: 'orgs',
      label: 'Vertical orgs',
      description: 'Manage Sendero and future vertical agent organizations',
      section: 'Navigate',
      keywords: 'org switcher workspace vertical organization',
      icon: Building2,
      run: ({ push }) => push('/dashboard/orgs'),
    },
    {
      id: 'toggle-mode',
      label: ctx.resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      description: 'Toggle the admin color mode',
      section: 'Theme',
      keywords: 'dark light mode appearance',
      icon: ctx.resolvedTheme === 'dark' ? Sun : Moon,
      shortcut: 'D D',
      run: ({ resolvedTheme, setTheme }) => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'toggle-platform-theme',
      label: ctx.platformTheme === 'zen' ? 'Use Sendero theme' : 'Use Zen theme',
      description: 'Switch the admin visual theme',
      section: 'Theme',
      keywords: 'sendero zen palette brand theme',
      icon: Palette,
      shortcut: 'T T',
      run: ({ platformTheme, setPlatformTheme }) =>
        setPlatformTheme(platformTheme === 'zen' ? 'sendero' : 'zen'),
    },
  ];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  );
}

export function AdminCommandPalette() {
  const router = useRouter();
  const { platformTheme, resolvedTheme, setPlatformTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const ctx = React.useMemo<CommandContext>(
    () => ({
      platformTheme,
      resolvedTheme,
      setPlatformTheme,
      setTheme,
      push: href => router.push(href),
    }),
    [platformTheme, resolvedTheme, router, setPlatformTheme, setTheme]
  );

  const commands = React.useMemo(() => buildCommands(ctx), [ctx]);

  const filteredCommands = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(command =>
      `${command.label} ${command.description} ${command.section} ${command.keywords}`
        .toLowerCase()
        .includes(needle)
    );
  }, [commands, query]);

  React.useEffect(() => {
    const openPalette = () => setOpen(true);
    window.addEventListener(COMMAND_PALETTE_EVENT, openPalette);
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, openPalette);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setOpen(current => !current);
        return;
      }

      if (!open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(current => Math.min(current + 1, filteredCommands.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(current => Math.max(current - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        const command = filteredCommands[activeIndex];
        if (!command) return;
        event.preventDefault();
        command.run(ctx);
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, ctx, filteredCommands, open]);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const grouped = groupCommands(filteredCommands);

  return (
    <div
      className="fixed inset-0 z-50 bg-[color:var(--color-background)]/70 p-4 backdrop-blur-sm"
      onMouseDown={event => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="mx-auto mt-24 w-full max-w-2xl overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-card-foreground)] shadow-2xl">
        <div className="flex h-14 items-center gap-3 border-b border-[color:var(--color-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search admin actions..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--color-muted-foreground)]"
          />
          <kbd className="rounded border bg-[color:var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
            ESC
          </kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-[color:var(--color-muted-foreground)]">
              No admin action found.
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.section} className="py-1">
                <div className="px-3 py-2 text-xs font-medium uppercase text-[color:var(--color-muted-foreground)]">
                  {group.section}
                </div>
                {group.commands.map(command => {
                  const absoluteIndex = filteredCommands.findIndex(item => item.id === command.id);
                  const Icon = command.icon;
                  const active = absoluteIndex === activeIndex;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm outline-none',
                        active
                          ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-foreground)]'
                          : 'hover:bg-[color:var(--color-muted)]'
                      )}
                      onMouseEnter={() => setActiveIndex(absoluteIndex)}
                      onClick={() => {
                        command.run(ctx);
                        setOpen(false);
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{command.label}</span>
                        <span className="block truncate text-xs text-[color:var(--color-muted-foreground)]">
                          {command.description}
                        </span>
                      </span>
                      {command.shortcut ? (
                        <kbd className="rounded border bg-[color:var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
                          {command.shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[color:var(--color-border)] px-4 py-2 text-xs text-[color:var(--color-muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Sendero admin actions
          </span>
          <span>↑↓ navigate · Enter open</span>
        </div>
      </div>
    </div>
  );
}

function groupCommands(commands: AdminCommand[]) {
  const sections: AdminCommand['section'][] = ['Navigate', 'Create', 'Theme'];
  return sections
    .map(section => ({
      section,
      commands: commands.filter(command => command.section === section),
    }))
    .filter(group => group.commands.length > 0);
}

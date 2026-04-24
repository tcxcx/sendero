'use client';

import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@sendero/ui/tooltip';

type IconProps = { className?: string };

// Brand glyphs inlined so we don't depend on lucide's brand icons (dropped
// in lucide v1 over TM concerns). 16px viewport, currentColor for theming.
function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M9.293 7.005 14.41 1.5h-1.213L8.748 6.275 5.205 1.5H1.121l5.367 7.234L1.121 14.5h1.214l4.692-4.972L10.795 14.5h4.084L9.293 7.005Zm-1.661 1.76-.544-.733L2.768 2.354h1.864l3.494 4.706.544.732 4.55 6.124H11.36L7.632 8.766Z" />
    </svg>
  );
}

function InstagramIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.22-1.11a7.93 7.93 0 0 0 3.79.97h.01a7.94 7.94 0 0 0 7.94-7.94 7.88 7.88 0 0 0-2.36-5.6Zm-5.55 12.21h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.66.67-2.44-.16-.25a6.6 6.6 0 1 1 12.25-3.5 6.6 6.6 0 0 1-6.65 6.59Zm3.62-4.94c-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.23.15-.43.05-.2-.1-.83-.31-1.59-.98-.59-.52-.99-1.17-1.1-1.37-.12-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.07-.13.03-.25-.02-.35-.05-.1-.45-1.08-.62-1.48-.16-.39-.33-.34-.45-.34l-.39-.01a.74.74 0 0 0-.54.25c-.18.2-.7.69-.7 1.67s.72 1.94.82 2.07c.1.13 1.41 2.16 3.42 3.03 1.2.52 1.66.56 2.26.47.36-.05 1.18-.48 1.35-.95.17-.46.17-.86.12-.95-.05-.08-.18-.13-.38-.23Z" />
    </svg>
  );
}

type Social = { label: string; href: string; icon: React.ComponentType<IconProps> };

// Each social hides itself if neither an env override nor a real default URL
// resolves — keeps the row from advertising a "WhatsApp" link that lands on
// wa.me's marketing page when no recipient is configured.
const SOCIALS: Social[] = [
  {
    label: 'X · @sendero',
    href: process.env.NEXT_PUBLIC_SENDERO_X_URL ?? 'https://x.com/senderotravel',
    icon: XIcon,
  },
  {
    label: 'Instagram · @sendero',
    href: process.env.NEXT_PUBLIC_SENDERO_IG_URL ?? 'https://instagram.com/senderotravel',
    icon: InstagramIcon,
  },
  {
    label: 'WhatsApp · message us',
    href: process.env.NEXT_PUBLIC_SENDERO_WA_URL ?? '',
    icon: WhatsAppIcon,
  },
].filter(s => !!s.href);

export function SocialsRow() {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div
        className="flex w-full items-center justify-center gap-1 px-3 py-3 group-data-[collapsible=icon]:hidden"
        aria-label="Sendero social channels"
      >
        {SOCIALS.map(s => (
          <Tooltip key={s.label}>
            <TooltipTrigger asChild>
              <Link
                href={s.href}
                target="_blank"
                rel="noreferrer"
                aria-label={s.label}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--text-dim)] transition-colors hover:bg-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] hover:text-[color:var(--ink)]"
              >
                <s.icon className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              data-variant="ink"
              className="font-mono text-[10px] uppercase tracking-[0.12em]"
            >
              {s.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

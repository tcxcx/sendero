import type { ReactNode } from 'react';
import Link from 'next/link';

import { OrganizationSwitcher, Show, UserButton } from '@clerk/nextjs';
import { Button } from '@sendero/ui/button';

import { LanguageSelector } from '../language-selector';

type AppHeaderCopy = {
  signIn: string;
  getStarted: string;
};

const defaultCopy: AppHeaderCopy = {
  signIn: 'Sign in',
  getStarted: 'Get started',
};

export function AppHeader({
  copy = defaultCopy,
  locale = 'en-US',
  startSlot,
}: {
  copy?: AppHeaderCopy;
  locale?: string;
  startSlot?: ReactNode;
}) {
  return (
    <header className="flex h-16 min-w-0 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {startSlot}
        <Link href="/app" className="flex min-w-0 items-center gap-2">
          <img
            alt=""
            className="h-7 w-7 shrink-0 object-contain"
            decoding="async"
            src="/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png"
          />
          <span className="font-mono text-sm font-medium uppercase tracking-wide">Sendero</span>
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <LanguageSelector canonicalPath="/app" currentLocale={locale} />
        <Show when="signed-in">
          <OrganizationSwitcher
            afterSelectOrganizationUrl="/app"
            afterCreateOrganizationUrl="/onboarding"
          />
          <UserButton userProfileUrl="/app/settings/profile" />
        </Show>
        <Show when="signed-out">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">{copy.signIn}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">{copy.getStarted}</Link>
          </Button>
        </Show>
      </div>
    </header>
  );
}

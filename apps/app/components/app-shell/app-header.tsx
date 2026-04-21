import { OrganizationSwitcher, Show, UserButton } from '@clerk/nextjs';
import { Button } from '@sendero/ui/button';
import Link from 'next/link';

export function AppHeader() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <Link href="/app" className="flex items-center gap-2">
        <span className="block size-3 rounded-sm bg-primary" />
        <span className="font-mono text-sm font-medium uppercase tracking-wide">Sendero</span>
      </Link>
      <div className="flex items-center gap-3">
        <Show when="signed-in">
          <OrganizationSwitcher
            afterSelectOrganizationUrl="/app"
            afterCreateOrganizationUrl="/onboarding"
          />
          <UserButton userProfileUrl="/app/settings/profile" />
        </Show>
        <Show when="signed-out">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </Show>
      </div>
    </header>
  );
}

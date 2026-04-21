import { OrganizationSwitcher, Show, UserButton } from '@clerk/nextjs';
import Link from 'next/link';

export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
      <Link href="/" className="flex items-center gap-2">
        <span className="block h-3 w-3 bg-[#fb542b]" />
        <span className="font-mono text-sm uppercase tracking-wide">Sendero</span>
      </Link>
      <div className="flex items-center gap-3">
        <Show when="signed-in">
          <OrganizationSwitcher
            afterSelectOrganizationUrl="/app"
            afterCreateOrganizationUrl="/onboarding"
          />
          <UserButton userProfileUrl="/app/profile" />
        </Show>
        <Show when="signed-out">
          <Link href="/sign-in" className="text-sm text-neutral-700 hover:text-black">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded bg-[#fb542b] px-4 py-2 text-sm text-white hover:bg-[#d13d18]"
          >
            Get started
          </Link>
        </Show>
      </div>
    </header>
  );
}

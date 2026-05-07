import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';

import { requireSuperadmin } from '@/lib/superadmin';

/**
 * Hit when a signed-in user reaches the admin app without the
 * `sendero_superadmin` role on their Clerk publicMetadata. Tells the
 * superadmin (or whoever's looking) what to do next; falls through
 * gracefully when the visitor is already signed out.
 */
export default async function UnauthorizedPage() {
  const result = await requireSuperadmin();
  const signedIn = result.ok || result.reason !== 'unauthenticated';
  const email = result.ok ? result.email : (result.email ?? null);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold">Not authorized</h1>
      <p className="text-base text-[color:var(--color-muted-fg)]">
        This account is not registered as a Sendero superadmin.
        {email ? (
          <>
            {' '}
            Currently signed in as <code>{email}</code>.
          </>
        ) : null}
      </p>
      <div className="rounded-lg border bg-[color:var(--color-muted)] px-4 py-3 text-left text-sm">
        <p className="font-medium">If you should have access:</p>
        <ol className="mt-2 list-decimal pl-5 text-[color:var(--color-muted-fg)]">
          <li>
            Ask an existing superadmin to set
            <code className="mx-1">{`{ "role": "superadmin" }`}</code>
            on your Clerk Public metadata.
          </li>
          <li>Sign out and back in to refresh your session.</li>
        </ol>
      </div>
      <div className="flex gap-3">
        <Link href="/sign-in" className="rounded-md border px-4 py-2 text-sm font-medium">
          Try a different account
        </Link>
        {signedIn ? (
          <SignOutButton>
            <button
              type="button"
              className="rounded-md bg-[color:var(--color-fg)] px-4 py-2 text-sm font-medium text-[color:var(--color-bg)]"
            >
              Sign out
            </button>
          </SignOutButton>
        ) : null}
      </div>
    </main>
  );
}

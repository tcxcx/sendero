import Link from 'next/link';
import { auth, currentUser } from '@clerk/nextjs/server';
import { SignOutButton } from '@clerk/nextjs';

import { getPlatformRoles } from '@/lib/access';

/**
 * Hit when:
 *   - signed-in user has no `platformRoles` on Clerk publicMetadata, OR
 *   - signed-in user has roles but tried a route their roles don't permit
 *     (per-page guards redirect here).
 *
 * Either way, the explainer instructs the operator on the bootstrap
 * action: a Sendero superadmin sets the right `platformRoles` array
 * on the user's Clerk public metadata.
 */
export default async function UnauthorizedPage() {
  const { userId } = await auth();
  const user = userId ? await currentUser() : null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const roles = await getPlatformRoles();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold">Not authorized</h1>
      <p className="text-base text-[color:var(--color-muted-fg)]">
        {roles.length > 0 ? (
          <>
            Your role
            {roles.length > 1 ? 's' : ''} (<code>{roles.join(', ')}</code>)
            don&apos;t have access to that page.
          </>
        ) : (
          'This account does not carry any Sendero platform role.'
        )}
        {email ? <> Currently signed in as <code>{email}</code>.</> : null}
      </p>
      <div className="rounded-lg border bg-[color:var(--color-muted)] px-4 py-3 text-left text-sm">
        <p className="font-medium">If you should have access:</p>
        <ol className="mt-2 list-decimal pl-5 text-[color:var(--color-muted-fg)]">
          <li>
            Ask a Sendero superadmin to set
            <code className="mx-1">{`{ "platformRoles": [...] }`}</code>
            on your Clerk Public metadata. Valid roles:
            <code className="mx-1">superadmin</code>,
            <code className="mx-1">sales</code>,
            <code className="mx-1">eng</code>,
            <code className="mx-1">support</code>,
            <code className="mx-1">finance</code>. Multiple allowed
            (e.g. <code>["superadmin", "eng"]</code>).
          </li>
          <li>Sign out and back in to refresh your session JWT.</li>
        </ol>
      </div>
      <div className="flex gap-3">
        <Link
          href="/sign-in"
          className="rounded-md border px-4 py-2 text-sm font-medium"
        >
          Try a different account
        </Link>
        <SignOutButton>
          <button
            type="button"
            className="rounded-md bg-[color:var(--color-fg)] px-4 py-2 text-sm font-medium text-[color:var(--color-bg)]"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}

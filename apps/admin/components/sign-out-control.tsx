'use client';

import { useClerk } from '@clerk/nextjs';

export function SignOutControl() {
  const { signOut } = useClerk();

  return (
    <button
      type="button"
      className="rounded-md bg-[color:var(--color-fg)] px-4 py-2 text-sm font-medium text-[color:var(--color-bg)]"
      onClick={() => void signOut({ redirectUrl: '/sign-in' })}
    >
      Sign out
    </button>
  );
}

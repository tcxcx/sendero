import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

type ClerkOrgRole = 'org:admin' | 'org:finance' | 'org:member';

export async function requireAnyRole(
  roles: ClerkOrgRole[],
  opts: { fallback?: string } = {}
): Promise<void> {
  const { has } = await auth();
  if (!roles.some(role => has({ role }))) {
    redirect(opts.fallback ?? '/dashboard');
  }
}

export async function requireRole(
  role: ClerkOrgRole,
  opts: { fallback?: string } = {}
): Promise<void> {
  await requireAnyRole([role], opts);
}

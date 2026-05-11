import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth();

  // Travelers (B2C) must never reach operator onboarding — defense in
  // depth alongside the proxy gate. Stops manual URL navigation, deep
  // links, and any leftover redirects.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind === 'traveler') redirect('/me');

  // /onboarding/create is the explicit "I want a NEW org while already
  // signed into a provisioned one" entry — skip the completion bounce
  // there; everywhere else, an already-onboarded org belongs on /dashboard.
  const pathname = (await headers()).get('x-pathname') ?? '';
  const isCreatingNewOrg = pathname.startsWith('/onboarding/create');
  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { onboardingComplete?: boolean };
  if (orgMeta.onboardingComplete === true && !isCreatingNewOrg) redirect('/dashboard');
  return <div className="app-shell-root relative flex min-h-svh w-full flex-col">{children}</div>;
}

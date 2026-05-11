import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth();

  // Travelers (B2C) must never reach operator onboarding — defense in
  // depth alongside the proxy gate. Stops manual URL navigation, deep
  // links, and any leftover redirects.
  const userMeta = (sessionClaims?.public_metadata ?? {}) as { kind?: string };
  if (userMeta.kind === 'traveler') redirect('/me');

  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { onboardingComplete?: boolean };
  if (orgMeta.onboardingComplete === true) redirect('/dashboard');
  return <>{children}</>;
}
